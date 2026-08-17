import { randomUUID } from "node:crypto";
import {
  ConversationAgentOutputSchema,
  DayItinerarySnapshotSchema,
  ItineraryNotificationSchema,
  ItineraryCommandSchema,
  RouteSignalSchema,
  type DemoScenario,
  type ConversationAgentOutput,
  type ConversationRun,
  type DayItinerarySnapshot,
  type ItineraryCommand,
  type ItineraryNotification,
  type RouteSignal,
  type CityFeedQuery,
  type CityFeedSnapshot,
} from "../../contracts";
import {
  ConversationAgentOutputInvalidError,
  ConversationAgentUnavailableError,
  type ItineraryAgent,
} from "../conversation/agent";
import { createItineraryAgent } from "../conversation/gemini";
import { DayItineraryPlanner } from "./planner";
import { ItineraryStore } from "./store";
import { GoogleRoutesProvider } from "../routing/google";
import { RoutePlanner } from "../routing/planner";
import { demoSignal } from "./demo";
import { CityDataGateway } from "../city/gateway";

export type ItineraryOperationResult = {
  itinerary: DayItinerarySnapshot;
  lastRun: ConversationRun;
  assistantMessage?: string;
  notification?: ItineraryNotification;
};

function now(): string {
  return new Date().toISOString();
}

function stopId(): string {
  return `stop-${randomUUID()}`;
}

function changedSnapshot(current: DayItinerarySnapshot, next: DayItinerarySnapshot): boolean {
  return (
    JSON.stringify({ ...current, revision: 0, updatedAt: "" }) !==
    JSON.stringify({ ...next, revision: 0, updatedAt: "" })
  );
}

export class ItineraryOrchestrator {
  constructor(
    private readonly store: ItineraryStore,
    private readonly agent: ItineraryAgent,
    private readonly planner: DayItineraryPlanner,
    private readonly cityGateway: CityDataGateway = new CityDataGateway(),
  ) {}

  createSession(userId: string, date: string): DayItinerarySnapshot {
    return this.store.createSession(userId, date);
  }

  listSessions(userId: string): DayItinerarySnapshot[] {
    return this.store.listSessions(userId);
  }

  deleteSession(id: string): boolean {
    return this.store.deleteSession(id);
  }

  getSession(id: string): DayItinerarySnapshot | undefined {
    return this.store.getSession(id);
  }

  getLatestRun(id: string): ConversationRun | undefined {
    return this.store.getLatestRun(id);
  }

  getRuns(id: string): ConversationRun[] {
    return this.store.getRuns(id);
  }

  async sendMessage(sessionId: string, userMessage: string): Promise<ItineraryOperationResult> {
    const current = this.store.getSession(sessionId);
    if (!current) throw new Error("找不到一天行程 session");
    const run = this.store.createRun(sessionId, userMessage);
    this.store.saveRun({ ...run, status: "running" });
    try {
      const previousInteractionId = this.store
        .getRuns(sessionId)
        .findLast(
          (candidate) => candidate.status === "succeeded" && candidate.interactionId,
        )?.interactionId;
      const agentResult = await this.agent.interpret(current, userMessage, previousInteractionId);
      const parsedOutput = this.parseOutput(agentResult.output);
      const applied = await this.applyCommand(
        current,
        parsedOutput.command,
        parsedOutput.planningStatus,
      );
      const itinerary = applied.changed ? this.store.saveSession(applied.snapshot) : current;
      const completed = this.store.saveRun({
        ...run,
        status: "succeeded",
        output: parsedOutput,
        interactionId: agentResult.interactionId,
        completedAt: now(),
      });
      return { itinerary, lastRun: completed, assistantMessage: parsedOutput.message };
    } catch (error) {
      const failed = this.store.saveRun({
        ...run,
        status: "failed",
        error: {
          code:
            error instanceof ConversationAgentOutputInvalidError
              ? "agent_output_invalid"
              : error instanceof ConversationAgentUnavailableError
                ? "agent_unavailable"
                : "workflow_invalid",
          message: error instanceof Error ? error.message : "行程對話處理失敗",
        },
        completedAt: now(),
      });
      return { itinerary: current, lastRun: failed };
    }
  }

  async refresh(sessionId: string, rawSignals: RouteSignal[]): Promise<ItineraryOperationResult> {
    const current = this.store.getSession(sessionId);
    if (!current) throw new Error("找不到一天行程 session");
    if (current.status !== "active" && current.status !== "update_pending") {
      throw new Error("行程尚未開始，不能執行即時更新");
    }
    const signals = rawSignals.map((signal) => RouteSignalSchema.parse(signal));
    const run = this.store.createRun(sessionId, "system:city_refresh");
    this.store.saveRun({ ...run, status: "running" });
    try {
      const refreshed = await this.planner.rebuild({ ...current, signals }, signals);
      const changedLegIds = DayItineraryPlanner.hasChanged(current, refreshed);
      const affectedStopIds = DayItineraryPlanner.affectedStopIds(refreshed, changedLegIds);
      let notification: ItineraryNotification | undefined;
      let next = refreshed;
      if (changedLegIds.length) {
        const changes = DayItineraryPlanner.routeChanges(
          current,
          refreshed,
          changedLegIds,
          signals,
        );
        notification = await this.agent.draftNotification({
          currentStatus: current.status,
          affectedLegIds: changedLegIds,
          affectedStopIds,
          reasonCodes: signals.map((signal) => signal.kind),
          evidenceIds: signals.map((signal) => signal.evidenceId),
          changes,
        });
        notification = ItineraryNotificationSchema.parse({
          ...notification,
          changes,
        });
        next = DayItinerarySnapshotSchema.parse({
          ...refreshed,
          status: notification.requiresConfirmation ? "update_pending" : current.status,
          notifications: [...current.notifications, notification],
        });
      }
      const itinerary = changedSnapshot(current, next) ? this.store.saveSession(next) : current;
      const completed = this.store.saveRun({
        ...run,
        status: "succeeded",
        notification,
        completedAt: now(),
      });
      return { itinerary, lastRun: completed, notification };
    } catch (error) {
      const failed = this.store.saveRun({
        ...run,
        status: "failed",
        error: {
          code: "workflow_invalid",
          message: error instanceof Error ? error.message : "行程更新失敗",
        },
        completedAt: now(),
      });
      return { itinerary: current, lastRun: failed };
    }
  }

  async demoRefresh(sessionId: string, scenario: DemoScenario): Promise<ItineraryOperationResult> {
    return this.refresh(sessionId, [demoSignal(scenario)]);
  }

  async refreshLive(
    sessionId: string,
    rawQuery: CityFeedQuery,
  ): Promise<ItineraryOperationResult & { cityFeeds: CityFeedSnapshot }> {
    const current = this.store.getSession(sessionId);
    if (!current) throw new Error("找不到一天行程 session");
    const cityFeeds = await this.cityGateway.refresh(rawQuery);
    const signals = cityFeeds.signals.length ? cityFeeds.signals : current.signals;
    return { ...(await this.refresh(sessionId, signals)), cityFeeds };
  }

  private parseOutput(output: ConversationAgentOutput): ConversationAgentOutput {
    return ConversationAgentOutputSchema.parse(output);
  }

  private async applyCommand(
    current: DayItinerarySnapshot,
    rawCommand: ItineraryCommand,
    planningStatus: ConversationAgentOutput["planningStatus"],
  ): Promise<{ snapshot: DayItinerarySnapshot; changed: boolean }> {
    const command = ItineraryCommandSchema.parse(rawCommand);
    if (command.action === "ask_clarification") return { snapshot: current, changed: false };
    if (command.action === "propose_day") {
      const proposed = DayItinerarySnapshotSchema.parse({
        ...current,
        status:
          current.status === "active"
            ? "active"
            : planningStatus === "ready"
              ? "ready"
              : "discussing",
        date: command.date,
        startAt: command.startAt,
        endAt: command.endAt,
        origin: command.origin,
        returnHome: command.returnHome,
        profiles: command.profiles,
        stops: command.stops.map((stop) => ({ ...stop, id: stopId(), status: "planned" })),
        legs: [],
        signals: [],
      });
      return { snapshot: await this.planner.rebuild(proposed, []), changed: true };
    }
    if (command.action === "add_stop") {
      const stops = [...current.stops];
      const insertAt = command.afterStopId
        ? stops.findIndex((stop) => stop.id === command.afterStopId) + 1
        : stops.length;
      stops.splice(Math.max(insertAt, 0), 0, { ...command.stop, id: stopId(), status: "planned" });
      const next = DayItinerarySnapshotSchema.parse({
        ...current,
        status:
          current.status === "active"
            ? "active"
            : planningStatus === "ready"
              ? "ready"
              : "discussing",
        stops,
      });
      return { snapshot: await this.planner.rebuild(next, current.signals), changed: true };
    }
    if (command.action === "remove_stop") {
      const stops = current.stops.filter((stop) => stop.id !== command.stopId);
      const next = DayItinerarySnapshotSchema.parse({
        ...current,
        status: stops.length
          ? current.status === "active"
            ? "active"
            : planningStatus === "ready"
              ? "ready"
              : "discussing"
          : "discussing",
        stops,
        currentStopId: current.currentStopId === command.stopId ? undefined : current.currentStopId,
      });
      return { snapshot: await this.planner.rebuild(next, current.signals), changed: true };
    }
    if (command.action === "move_stop") {
      const moving = current.stops.find((stop) => stop.id === command.stopId);
      if (!moving) throw new Error("找不到要移動的景點");
      const remaining = current.stops.filter((stop) => stop.id !== command.stopId);
      const insertAt = command.afterStopId
        ? remaining.findIndex((stop) => stop.id === command.afterStopId) + 1
        : 0;
      remaining.splice(Math.max(insertAt, 0), 0, moving);
      const next = DayItinerarySnapshotSchema.parse({
        ...current,
        status:
          current.status === "active"
            ? "active"
            : planningStatus === "ready"
              ? "ready"
              : "discussing",
        stops: remaining,
      });
      return { snapshot: await this.planner.rebuild(next, current.signals), changed: true };
    }
    if (command.action === "start_navigation") {
      if (!current.stops.length) throw new Error("尚未建立今日行程");
      if (current.status !== "ready") throw new Error("LLM 尚未確認行程完整");
      if (current.legs.some((leg) => leg.status === "blocked")) {
        throw new Error("仍有交通路段無法安全安排");
      }
      if (current.date !== new Date().toISOString().slice(0, 10)) {
        throw new Error(`請在 ${current.date} 當天開始行程`);
      }
      const firstStopId = current.stops[0]?.id;
      const legs = current.legs.map((leg, index) => ({
        ...leg,
        status: leg.status === "blocked" ? "blocked" : index === 0 ? "active" : "planned",
      }));
      return {
        snapshot: DayItinerarySnapshotSchema.parse({
          ...current,
          status: "active",
          currentStopId: firstStopId,
          legs,
          updatedAt: now(),
        }),
        changed: true,
      };
    }
    if (command.action === "complete_navigation") {
      if (current.status !== "active") throw new Error("行程尚未開始");
      return {
        snapshot: DayItinerarySnapshotSchema.parse({
          ...current,
          status: "completed",
          currentStopId: undefined,
          stops: current.stops.map((stop) => ({ ...stop, status: "visited" })),
          legs: current.legs.map((leg) => ({
            ...leg,
            status: leg.status === "blocked" ? "blocked" : "completed",
          })),
          updatedAt: now(),
        }),
        changed: true,
      };
    }
    const notifications = current.notifications.map((notification) =>
      notification.id === command.notificationId
        ? { ...notification, readAt: now() }
        : notification,
    );
    return {
      snapshot: DayItinerarySnapshotSchema.parse({ ...current, notifications }),
      changed: true,
    };
  }
}

export const itineraryOrchestrator = new ItineraryOrchestrator(
  new ItineraryStore(),
  createItineraryAgent(),
  new DayItineraryPlanner(new RoutePlanner(new GoogleRoutesProvider())),
  new CityDataGateway(),
);
