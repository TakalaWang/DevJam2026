import {
  ConversationAgentOutputSchema,
  ConversationAgentResultSchema,
  EmptyPlanningFacts,
  ItineraryNotificationSchema,
  PlanningFactsSchema,
  type ConversationAgentOutput,
  type ConversationAgentResult,
  type DayItinerarySnapshot,
  type NotificationAgentInput,
  type NotificationAgentOutput,
} from "../../contracts";
import type { ItineraryAgent } from "./agent";

const taipeiStation = { label: "台北車站", coordinate: { latitude: 25.0478, longitude: 121.517 } };
const venue = { label: "台北小巨蛋", coordinate: { latitude: 25.0515, longitude: 121.5493 } };
const exhibition = {
  label: "台北市立美術館",
  coordinate: { latitude: 25.0716, longitude: 121.5246 },
};
const dinner = { label: "迪化街", coordinate: { latitude: 25.0566, longitude: 121.5103 } };

function factsFor(date: string, status: "provided" | "confirmed", destination: string) {
  return PlanningFactsSchema.parse({
    origin: { status, value: taipeiStation },
    destinations: { status, value: [destination] },
    departureAt: { status, value: `${date}T10:00:00+08:00` },
    endAt: { status, value: `${date}T22:00:00+08:00` },
    fixedActivities: {
      status,
      value: [
        {
          title: destination,
          startAt: `${date}T19:00:00+08:00`,
          endAt: `${date}T22:00:00+08:00`,
        },
      ],
    },
    transportPreference: { status, value: "public_transit" },
    returnPlan: { status, value: { returnHome: true, location: taipeiStation } },
    constraints: { status, value: ["不要太早出門"] },
    assumptions: [],
    confirmation: status === "confirmed" ? "confirmed" : "pending",
  });
}

function collectingFacts(destination: string) {
  return PlanningFactsSchema.parse({
    ...EmptyPlanningFacts,
    destinations: { status: "provided", value: [destination] },
  });
}

export class FixtureItineraryAgent implements ItineraryAgent {
  private readonly messages = new Map<string, string[]>();

  async interpret(
    itinerary: DayItinerarySnapshot,
    userMessage: string,
  ): Promise<ConversationAgentResult> {
    const history = [...(this.messages.get(itinerary.id) ?? []), userMessage];
    this.messages.set(itinerary.id, history);
    const context = history.join("\n");
    const result = (output: ConversationAgentOutput): ConversationAgentResult =>
      ConversationAgentResultSchema.parse({
        output,
        interactionId: `fixture-${itinerary.id}`,
      });
    const blockedLeg = itinerary.legs.find(
      (leg) => leg.status === "blocked" && leg.toStopId !== "home",
    );
    if (blockedLeg && userMessage.includes("改去")) {
      const blockedStop = itinerary.stops.find((stop) => stop.id === blockedLeg.toStopId);
      if (blockedStop) {
        const title = userMessage
          .replace(/^.*?改去/, "")
          .replace(/[。！!].*$/, "")
          .trim();
        return result(
          ConversationAgentOutputSchema.parse({
            message: `收到，我會把${blockedStop.title}替換成${title || "新的景點"}，重新檢查後續路線。`,
            planningPhase: "refining",
            planningStatus: "ready",
            facts: itinerary.planningFacts,
            command: {
              action: "replace_stop",
              stopId: blockedStop.id,
              stop: {
                title: title || "新的景點",
                location: { ...blockedStop.location, label: title || "新的景點" },
                durationMinutes: blockedStop.durationMinutes,
                constraint: blockedStop.constraint,
                ...(blockedStop.timeWindow ? { timeWindow: blockedStop.timeWindow } : {}),
                evidenceIds: [],
              },
            },
          }),
        );
      }
    }
    if (userMessage.includes("開始")) {
      return result(
        ConversationAgentOutputSchema.parse({
          message: "行程開始，我會持續留意目前路線與城市狀況。",
          planningPhase: "refining",
          planningStatus: "ready",
          facts: itinerary.planningFacts,
          command: { action: "start_navigation" },
        }),
      );
    }
    if (userMessage.includes("完成")) {
      return result(
        ConversationAgentOutputSchema.parse({
          message: "今天的行程已完成，所有路段都已結束。",
          planningPhase: "refining",
          planningStatus: "ready",
          facts: itinerary.planningFacts,
          command: { action: "complete_navigation" },
        }),
      );
    }
    const wantsRecommendations = /推薦|出去玩|不知道去哪|哪裡好玩/.test(context);
    const region = ["中山", "大安", "信義", "西門町", "淡水", "北投"].find((name) =>
      context.includes(name),
    );
    if (!itinerary.stops.length && wantsRecommendations) {
      const message = region
        ? `${region}很適合慢慢玩，我先給你 3 個候選景點（都還沒放進行程）：赤峰街逛街與咖啡、雙連市場吃在地小吃、台北當代藝術館看展。你想選哪一個？也可以告訴我想要美食、展覽或戶外，我再縮小範圍。`
        : "可以，我先幫你縮小範圍。你想玩哪個城市或區域？如果還沒決定，台北可以先從中山（街區與咖啡）、大安（公園與美食）、信義（景觀與購物）三個候選方向挑一個；選定後我再推薦 2–3 個景點。";
      return result(
        ConversationAgentOutputSchema.parse({
          message,
          planningPhase: "collecting",
          planningStatus: "needs_details",
          facts: itinerary.planningFacts,
          command: {
            action: "ask_clarification",
            question: region
              ? "請從候選景點中選一個，或告訴我想要的活動類型。"
              : "請告訴我想玩的城市或區域，以及偏好的活動類型。",
          },
        }),
      );
    }
    if (context.includes("演唱會")) {
      const confirmed = /確認|沒問題|沒有問題|可以|對的|正確|就這樣|ok|okay/i.test(userMessage);
      const hasDetails = context.includes("台北車站");
      if (!hasDetails) {
        return result(
          ConversationAgentOutputSchema.parse({
            message:
              "我可以幫你安排演唱會，但還需要出發位置、預計出門與回家時間、交通偏好，以及是否一定要回家。",
            planningPhase: "collecting",
            planningStatus: "needs_details",
            facts: collectingFacts("演唱會"),
            command: {
              action: "ask_clarification",
              question: "請補充出發位置、時間、交通方式與回程安排。",
            },
          }),
        );
      }
      if (!confirmed) {
        return result(
          ConversationAgentOutputSchema.parse({
            message:
              "我整理好了：10:00 從台北車站出發，搭大眾運輸前往演唱會，22:00 前回到台北車站。這樣的安排可以嗎？",
            planningPhase: "awaiting_confirmation",
            planningStatus: "awaiting_confirmation",
            facts: factsFor(itinerary.date, "provided", "演唱會"),
            command: {
              action: "ask_clarification",
              question: "請回覆「確認」後，我才會建立完整行程。",
            },
          }),
        );
      }
      return result(
        ConversationAgentOutputSchema.parse({
          message:
            "需求已確認，我已安排從出門到回家的完整交通與活動：10:00 從台北車站出發，前往演唱會，22:00 前回到台北車站。行程已準備完成，今天可以出發時請按右側「開始行程」。",
          planningPhase: "scheduling",
          planningStatus: "ready",
          facts: factsFor(itinerary.date, "confirmed", "演唱會"),
          command: {
            action: "propose_day",
            date: itinerary.date,
            startAt: `${itinerary.date}T10:00:00+08:00`,
            endAt: `${itinerary.date}T22:00:00+08:00`,
            origin: taipeiStation,
            returnHome: true,
            profiles: ["transit"],
            stops: [
              {
                title: "城市咖啡",
                location: {
                  label: "華山文創園區",
                  coordinate: { latitude: 25.044, longitude: 121.529 },
                },
                durationMinutes: 90,
                constraint: "flexible",
                evidenceIds: ["fixture-cafe"],
              },
              {
                title: "演唱會",
                location: venue,
                durationMinutes: 180,
                constraint: "fixed",
                timeWindow: {
                  startAt: `${itinerary.date}T19:00:00+08:00`,
                  endAt: `${itinerary.date}T22:00:00+08:00`,
                },
                evidenceIds: ["fixture-concert"],
              },
            ],
          },
        }),
      );
    }
    if (context.includes("看展") || context.includes("展覽") || context.includes("吃飯")) {
      const confirmed = /確認|沒問題|沒有問題|可以|對的|正確|就這樣|ok|okay/i.test(userMessage);
      if (!context.includes("台北車站")) {
        return result(
          ConversationAgentOutputSchema.parse({
            message: "這個方向可以安排；我還需要知道你打算從哪裡出發，才能把交通段補完整。",
            planningPhase: "collecting",
            planningStatus: "needs_details",
            facts: collectingFacts("下午看展與晚餐"),
            command: {
              action: "ask_clarification",
              question: "請告訴我當天的出發位置，例如台北車站或住宿地點。",
            },
          }),
        );
      }
      return result(
        ConversationAgentOutputSchema.parse({
          message: confirmed
            ? "需求已確認，我已安排看展、晚餐與完整往返交通。行程已準備完成，今天可以出發時請按右側「開始行程」。"
            : "我整理好了：12:00 從台北車站出發，下午看展、晚上吃飯，20:30 前回到台北車站。這樣的安排可以嗎？",
          planningPhase: confirmed ? "scheduling" : "awaiting_confirmation",
          planningStatus: confirmed ? "ready" : "awaiting_confirmation",
          facts: factsFor(itinerary.date, confirmed ? "confirmed" : "provided", "下午看展與晚餐"),
          command: confirmed
            ? {
                action: "propose_day",
                date: itinerary.date,
                startAt: `${itinerary.date}T12:00:00+08:00`,
                endAt: `${itinerary.date}T20:30:00+08:00`,
                origin: taipeiStation,
                returnHome: true,
                profiles: ["transit"],
                stops: [
                  {
                    title: "下午看展",
                    location: exhibition,
                    durationMinutes: 120,
                    constraint: "fixed",
                    timeWindow: {
                      startAt: `${itinerary.date}T14:00:00+08:00`,
                      endAt: `${itinerary.date}T16:00:00+08:00`,
                    },
                    evidenceIds: ["fixture-exhibition"],
                  },
                  {
                    title: "晚餐散步",
                    location: dinner,
                    durationMinutes: 90,
                    constraint: "flexible",
                    evidenceIds: ["fixture-dinner"],
                  },
                ],
              }
            : {
                action: "ask_clarification",
                question: "請回覆「確認」後，我才會建立完整行程。",
              },
        }),
      );
    }
    return result(
      ConversationAgentOutputSchema.parse({
        message: itinerary.stops.length
          ? "你可以告訴我想新增、移除或調整哪個行程。"
          : "請告訴我今天想去哪裡，以及有沒有固定時間的活動。",
        planningPhase: "collecting",
        planningStatus: "needs_details",
        facts: itinerary.planningFacts,
        command: { action: "ask_clarification", question: "請提供今天想去的地點或固定活動。" },
      }),
    );
  }

  async draftNotification(input: NotificationAgentInput): Promise<NotificationAgentOutput> {
    const blocked = input.changes.some((change) => change.after.status === "blocked");
    return ItineraryNotificationSchema.parse({
      id: `fixture-notice-${Date.now()}`,
      kind: "service_disruption",
      severity: "warning",
      title: "行程路線需要更新",
      message:
        "路線更新：" +
        input.changes
          .map(
            (change) =>
              `${change.fromLabel} → ${change.toLabel}：${change.reason}；${change.tradeoffs.join("、")}。`,
          )
          .join(" ") +
        (blocked ? " 請問你是否想改去其他景點？" : ""),
      affectedLegIds: input.affectedLegIds,
      affectedStopIds: input.affectedStopIds,
      changes: input.changes,
      requiresConfirmation: false,
      evidenceIds: input.evidenceIds,
      createdAt: new Date().toISOString(),
    });
  }
}
