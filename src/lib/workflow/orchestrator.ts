import {
  ActivitySchema,
  AgentInputSchema,
  AgentOutputSchemas,
  type AgentName,
  type AgentRun,
  type Activity,
  type DayPlan,
  type TripSnapshot,
  TripInputSchema,
  type TripInput,
  type UserTurnInput,
  type UserTurnResult,
  UserTurnResultSchema,
} from "../../contracts";
import {
  AgentOutputInvalidError,
  AgentUnavailableError,
  createAgentRuntime,
  type AgentRuntime,
} from "./adk";
import { TripStore, tripStore } from "./store";
import { validateCrossDay, validateSchedule } from "./validator";

type WorkflowResult = { snapshot: TripSnapshot; output: UserTurnResult; agent?: AgentName };

function result(output: UserTurnInput): UserTurnResult {
  return UserTurnResultSchema.parse(output);
}

function currentDay(snapshot: TripSnapshot): DayPlan | undefined {
  return snapshot.days[snapshot.currentDayIndex];
}

function withPending(snapshot: TripSnapshot, pendingQuestion?: string): TripSnapshot {
  return { ...snapshot, pendingQuestion };
}

function addEvidence(snapshot: TripSnapshot, evidence: TripSnapshot["evidence"]): TripSnapshot {
  const merged = [...snapshot.evidence];
  for (const item of evidence)
    if (!merged.some((existing) => existing.id === item.id)) merged.push(item);
  return { ...snapshot, evidence: merged };
}

function withReviewAttempt(snapshot: TripSnapshot, key: string) {
  const attempts = (snapshot.reviewAttempts[key] ?? 0) + 1;
  return {
    snapshot: {
      ...snapshot,
      reviewAttempts: { ...snapshot.reviewAttempts, [key]: attempts },
    },
    blocked: attempts >= 3,
  };
}

function agentInput(snapshot: TripSnapshot, input: TripInput, correction?: string) {
  const userMessage = input.type === "message" ? input.message : input.type;
  return AgentInputSchema.parse({ tripId: snapshot.id, userMessage, snapshot, correction });
}

export class TripOrchestrator {
  constructor(
    private readonly store: TripStore = tripStore,
    private readonly runtimeFactory: () => AgentRuntime = createAgentRuntime,
  ) {}

  createTrip(userId: string) {
    return this.store.createTrip(userId);
  }

  getTrip(id: string) {
    return this.store.getTrip(id);
  }

  getRun(id: string) {
    return this.store.getRun(id);
  }

  getLatestRun(tripId: string) {
    return this.store.getLatestRun(tripId);
  }

  async process(
    tripId: string,
    rawInput: TripInput,
  ): Promise<{ snapshot: TripSnapshot; run: AgentRun }> {
    const input = TripInputSchema.parse(rawInput);
    const existing = this.store.getTrip(tripId);
    if (!existing) throw new Error("找不到旅程");

    const run = this.store.createRun(tripId, input.type);
    run.status = "running";
    run.events = [{ type: "started", at: new Date().toISOString() }];
    this.store.saveRun(run);

    try {
      const workflow = await this.advance(existing, input, this.runtimeFactory());
      const snapshot = this.store.saveTrip(workflow.snapshot);
      const completed = this.store.saveRun({
        ...run,
        status: "succeeded",
        agent: workflow.agent,
        output: workflow.output,
        events: [
          ...run.events,
          { type: "succeeded", at: new Date().toISOString(), output: workflow.output },
        ],
        completedAt: new Date().toISOString(),
      });
      return { snapshot, run: completed };
    } catch (error) {
      const failed = this.store.saveRun({
        ...run,
        status: "failed",
        error: {
          code:
            error instanceof AgentOutputInvalidError
              ? "agent_output_invalid"
              : error instanceof AgentUnavailableError
                ? "agent_unavailable"
                : "workflow_invalid",
          message: error instanceof Error ? error.message : "工作流執行失敗",
        },
        events: [
          ...run.events,
          {
            type: "failed",
            at: new Date().toISOString(),
            error: {
              code:
                error instanceof AgentOutputInvalidError
                  ? "agent_output_invalid"
                  : error instanceof AgentUnavailableError
                    ? "agent_unavailable"
                    : "workflow_invalid",
              message: error instanceof Error ? error.message : "工作流執行失敗",
            },
          },
        ],
        completedAt: new Date().toISOString(),
      });
      throw Object.assign(new Error(failed.error?.message ?? "工作流執行失敗"), { run: failed });
    }
  }

  private async advance(
    snapshot: TripSnapshot,
    input: TripInput,
    runtime: AgentRuntime,
  ): Promise<WorkflowResult> {
    if (input.type === "confirm_flight") return this.confirmFlight(snapshot, input.candidateId);
    if (input.type === "confirm_lodging") return this.confirmLodging(snapshot, input.candidateId);
    if (input.type === "confirm_plan") return this.confirmPlan(snapshot);
    if (input.type === "accept_activity")
      return this.setActivityStatus(snapshot, input.activityId, "confirmed");
    if (input.type === "reject_activity")
      return this.setActivityStatus(snapshot, input.activityId, "rejected");

    switch (snapshot.status) {
      case "intake":
      case "flight_confirmation":
      case "lodging_confirmation":
        return this.runTravelAgent(snapshot, input, runtime);
      case "slot_confirmation":
        return this.runFrameAgent(snapshot, input, runtime);
      case "preference_confirmation":
        return this.runActivityAgent(snapshot, input, runtime);
      case "scheduling_day":
        return this.runScheduleAgent(snapshot, input, runtime);
      case "daily_review":
        return this.runDailyReview(snapshot, input, runtime);
      case "awaiting_user_confirmation":
        return {
          snapshot: withPending(snapshot, "請確認完整行程，或告訴我需要修改的地方。"),
          output: result({
            kind: "question",
            message: "請確認完整行程，或告訴我需要修改的地方。",
            stateTransition: snapshot.status,
          }),
        };
      case "final":
        return { snapshot, output: result({ kind: "final", message: "這趟旅程已經確認完成。" }) };
      default:
        return {
          snapshot,
          output: result({ kind: "error", message: "目前行程狀態不接受這個訊息。" }),
        };
    }
  }

  private async runTravelAgent(
    snapshot: TripSnapshot,
    input: TripInput,
    runtime: AgentRuntime,
  ): Promise<WorkflowResult> {
    const output = await runtime.run(
      "travel_boundary",
      agentInput(snapshot, input),
      AgentOutputSchemas.travel_boundary,
    );
    const candidates =
      output.action === "present_candidates" || output.action === "complete"
        ? output.candidates
        : undefined;
    const next = withPending(
      addEvidence(
        {
          ...snapshot,
          travelCandidates: candidates ?? snapshot.travelCandidates,
          status: output.action === "present_candidates" ? "flight_confirmation" : snapshot.status,
        },
        output.evidence,
      ),
      output.message,
    );
    return {
      snapshot: next,
      output: result({
        kind: output.action === "ask_user" ? "question" : "proposal",
        message: output.message,
        options: candidates?.map((candidate) => candidate.id) ?? [],
        stateTransition: next.status,
      }),
      agent: "travel_boundary",
    };
  }

  private async runFrameAgent(
    snapshot: TripSnapshot,
    input: TripInput,
    runtime: AgentRuntime,
  ): Promise<WorkflowResult> {
    const output = await runtime.run(
      "daily_frame",
      agentInput(snapshot, input),
      AgentOutputSchemas.daily_frame,
    );
    if (output.action === "ask_user")
      return {
        snapshot: withPending(snapshot, output.message),
        output: result({ kind: "question", message: output.message }),
        agent: "daily_frame",
      };
    const next = addEvidence(
      {
        ...snapshot,
        days: output.days,
        status: "preference_confirmation" as const,
        pendingQuestion: output.message,
      },
      output.evidence,
    );
    return {
      snapshot: next,
      output: result({ kind: "progress", message: output.message, stateTransition: next.status }),
      agent: "daily_frame",
    };
  }

  private async runActivityAgent(
    snapshot: TripSnapshot,
    input: TripInput,
    runtime: AgentRuntime,
  ): Promise<WorkflowResult> {
    const output = await runtime.run(
      "activity_discovery",
      agentInput(snapshot, input),
      AgentOutputSchemas.activity_discovery,
    );
    if (output.action === "ask_user")
      return {
        snapshot: withPending(snapshot, output.message),
        output: result({ kind: "question", message: output.message }),
        agent: "activity_discovery",
      };
    const day = currentDay(snapshot) ?? {
      date: new Date().toISOString().slice(0, 10),
      slots: [],
      activities: [],
      schedule: [],
      reviewStatus: "pending" as const,
    };
    const nextDays = snapshot.days.length
      ? snapshot.days.map((item, index) =>
          index === snapshot.currentDayIndex ? { ...item, activities: output.activities } : item,
        )
      : [{ ...day, activities: output.activities }];
    const next = addEvidence(
      {
        ...snapshot,
        days: nextDays,
        status: "scheduling_day" as const,
        pendingQuestion: output.message,
      },
      output.evidence,
    );
    return {
      snapshot: next,
      output: result({ kind: "progress", message: output.message, stateTransition: next.status }),
      agent: "activity_discovery",
    };
  }

  private async runScheduleAgent(
    snapshot: TripSnapshot,
    input: TripInput,
    runtime: AgentRuntime,
  ): Promise<WorkflowResult> {
    const day = currentDay(snapshot);
    if (!day)
      return {
        snapshot: { ...snapshot, status: "blocked", lastError: "尚未建立每日框架" },
        output: result({ kind: "error", message: "尚未建立每日框架。" }),
      };
    const output = await runtime.run(
      "schedule",
      agentInput(snapshot, input),
      AgentOutputSchemas.schedule,
    );
    if (output.action === "ask_user")
      return {
        snapshot: withPending(snapshot, output.message),
        output: result({ kind: "question", message: output.message }),
        agent: "schedule",
      };
    if (output.action === "complete")
      return {
        snapshot: { ...snapshot, status: "daily_review" as const, pendingQuestion: output.message },
        output: result({
          kind: "progress",
          message: output.message,
          stateTransition: "daily_review",
        }),
        agent: "schedule",
      };
    if (output.action === "remove")
      return this.setActivityStatus(snapshot, output.targetActivityId, "rejected");

    const validation = validateSchedule(day, output.proposedScheduleItem);
    if (!validation.valid) {
      const attempt = withReviewAttempt(snapshot, `item:${output.proposedScheduleItem.id}`);
      const message = validation.findings.map((finding) => finding.message).join("；");
      return {
        snapshot: withPending(
          addEvidence(
            { ...attempt.snapshot, status: attempt.blocked ? "blocked" : "scheduling_day" },
            output.evidence,
          ),
          message,
        ),
        output: result({
          kind: attempt.blocked ? "error" : "question",
          message: attempt.blocked ? `${message} 已達到重試上限。` : message,
          stateTransition: attempt.blocked ? "blocked" : "scheduling_day",
        }),
        agent: "schedule",
      };
    }

    const review = await runtime.run(
      "item_review",
      agentInput(
        {
          ...addEvidence(snapshot, output.evidence),
          days: snapshot.days.map((item, index) =>
            index === snapshot.currentDayIndex
              ? { ...item, schedule: [...item.schedule, output.proposedScheduleItem] }
              : item,
          ),
        },
        input,
      ),
      AgentOutputSchemas.item_review,
    );
    if (review.decision !== "approved") {
      const attempt = withReviewAttempt(snapshot, `item:${output.proposedScheduleItem.id}`);
      const blocked = attempt.blocked;
      return {
        snapshot: withPending(
          addEvidence({ ...attempt.snapshot, status: blocked ? "blocked" : "scheduling_day" }, [
            ...output.evidence,
            ...review.evidence,
          ]),
          review.message,
        ),
        output: result({
          kind: blocked ? "error" : "question",
          message: blocked ? `${review.message} 已達到重試上限。` : review.message,
          stateTransition: blocked ? "blocked" : "scheduling_day",
        }),
        agent: "item_review",
      };
    }

    const schedule = [
      ...day.schedule.filter((item) => item.id !== output.proposedScheduleItem.id),
      { ...output.proposedScheduleItem, status: "approved" as const },
    ];
    const nextDay = { ...day, schedule, reviewStatus: "reviewing" as const };
    const nextDays = snapshot.days.map((item, index) =>
      index === snapshot.currentDayIndex ? nextDay : item,
    );
    const allScheduled = nextDay.activities
      .filter((activity) => activity.status !== "rejected")
      .every((activity) => nextDay.schedule.some((item) => item.activityId === activity.id));
    const next = addEvidence(
      {
        ...snapshot,
        days: nextDays,
        status: allScheduled ? ("daily_review" as const) : ("scheduling_day" as const),
        pendingQuestion: review.message,
      },
      [...output.evidence, ...review.evidence],
    );
    return {
      snapshot: next,
      output: result({ kind: "progress", message: review.message, stateTransition: next.status }),
      agent: "item_review",
    };
  }

  private async runDailyReview(
    snapshot: TripSnapshot,
    input: TripInput,
    runtime: AgentRuntime,
  ): Promise<WorkflowResult> {
    const crossDay = validateCrossDay(snapshot.days);
    if (!crossDay.valid)
      return {
        snapshot: {
          ...snapshot,
          status: "blocked" as const,
          lastError: crossDay.findings.map((finding) => finding.message).join("；"),
        },
        output: result({
          kind: "error",
          message: crossDay.findings.map((finding) => finding.message).join("；"),
        }),
      };
    const output = await runtime.run(
      "daily_review",
      agentInput(snapshot, input),
      AgentOutputSchemas.daily_review,
    );
    if (output.decision !== "approved") {
      const attempt = withReviewAttempt(
        snapshot,
        `day:${snapshot.days[snapshot.currentDayIndex]?.date ?? "unknown"}`,
      );
      const blocked = attempt.blocked;
      return {
        snapshot: withPending(
          addEvidence(
            { ...attempt.snapshot, status: blocked ? "blocked" : "scheduling_day" },
            output.evidence,
          ),
          output.message,
        ),
        output: result({
          kind: blocked ? "error" : "question",
          message: blocked ? `${output.message} 已達到重試上限。` : output.message,
          stateTransition: blocked ? "blocked" : "scheduling_day",
        }),
        agent: "daily_review",
      };
    }
    const next = addEvidence(
      {
        ...snapshot,
        status: "awaiting_user_confirmation" as const,
        pendingQuestion: output.message,
        days: snapshot.days.map((day, index) =>
          index === snapshot.currentDayIndex ? { ...day, reviewStatus: "approved" as const } : day,
        ),
      },
      output.evidence,
    );
    return {
      snapshot: next,
      output: result({ kind: "proposal", message: output.message, stateTransition: next.status }),
      agent: "daily_review",
    };
  }

  private confirmFlight(snapshot: TripSnapshot, candidateId: string): WorkflowResult {
    const candidate = snapshot.travelCandidates.find(
      (item) => item.id === candidateId && item.kind === "flight",
    );
    if (!candidate || candidate.kind !== "flight")
      return { snapshot, output: result({ kind: "error", message: "找不到指定航班候選。" }) };
    const next = {
      ...snapshot,
      confirmedFlightId: candidate.id,
      status: "lodging_confirmation" as const,
      pendingQuestion: "請確認住宿候選。",
    };
    return {
      snapshot: next,
      output: result({
        kind: "question",
        message: "航班已確認。請確認住宿候選。",
        stateTransition: next.status,
      }),
    };
  }

  private confirmLodging(snapshot: TripSnapshot, candidateId: string): WorkflowResult {
    const candidate = snapshot.travelCandidates.find(
      (item) => item.id === candidateId && item.kind === "lodging",
    );
    if (!candidate || candidate.kind !== "lodging")
      return { snapshot, output: result({ kind: "error", message: "找不到指定住宿候選。" }) };
    const next = {
      ...snapshot,
      confirmedLodgingId: candidate.id,
      status: "slot_confirmation" as const,
      pendingQuestion: "請描述每天的起床、睡覺、用餐與休息習慣。",
    };
    return {
      snapshot: next,
      output: result({
        kind: "question",
        message: next.pendingQuestion,
        stateTransition: next.status,
      }),
    };
  }

  private confirmPlan(snapshot: TripSnapshot): WorkflowResult {
    if (snapshot.status !== "awaiting_user_confirmation")
      return {
        snapshot,
        output: result({ kind: "error", message: "行程尚未完成 review，不能確認。" }),
      };
    const next = { ...snapshot, status: "final" as const, pendingQuestion: undefined };
    return {
      snapshot: next,
      output: result({ kind: "final", message: "完整行程已確認。", stateTransition: next.status }),
    };
  }

  private setActivityStatus(
    snapshot: TripSnapshot,
    activityId: string,
    status: Activity["status"],
  ): WorkflowResult {
    const nextDays = snapshot.days.map((day) => ({
      ...day,
      activities: day.activities.map((activity) =>
        activity.id === activityId ? ActivitySchema.parse({ ...activity, status }) : activity,
      ),
      schedule: day.schedule.map((item) =>
        item.activityId === activityId ? { ...item, status: "stale" as const } : item,
      ),
      reviewStatus: day.schedule.some((item) => item.activityId === activityId)
        ? ("stale" as const)
        : day.reviewStatus,
    }));
    const next = { ...snapshot, days: nextDays, status: "scheduling_day" as const };
    return {
      snapshot: next,
      output: result({
        kind: "progress",
        message: status === "confirmed" ? "活動已加入待排清單。" : "活動已移出待排清單。",
        stateTransition: next.status,
      }),
    };
  }
}

export const tripOrchestrator = new TripOrchestrator();
