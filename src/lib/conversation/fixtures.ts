import {
  ConversationAgentOutputSchema,
  ConversationAgentResultSchema,
  ItineraryNotificationSchema,
  type ConversationAgentOutput,
  type ConversationAgentResult,
  type DayItinerarySnapshot,
  type NotificationAgentInput,
  type NotificationAgentOutput,
} from "../../contracts";
import type { ItineraryAgent } from "./agent";

const taipeiStation = { label: "台北車站", coordinate: { latitude: 25.0478, longitude: 121.517 } };
const venue = { label: "台北小巨蛋", coordinate: { latitude: 25.0515, longitude: 121.5493 } };

export class FixtureItineraryAgent implements ItineraryAgent {
  async interpret(
    itinerary: DayItinerarySnapshot,
    userMessage: string,
  ): Promise<ConversationAgentResult> {
    const result = (output: ConversationAgentOutput): ConversationAgentResult =>
      ConversationAgentResultSchema.parse({
        output,
        interactionId: `fixture-${itinerary.id}`,
      });
    if (userMessage.includes("開始")) {
      return result(
        ConversationAgentOutputSchema.parse({
          message: "行程開始，我會持續留意目前路線與城市狀況。",
          planningStatus: "ready",
          command: { action: "start_navigation" },
        }),
      );
    }
    if (userMessage.includes("完成")) {
      return result(
        ConversationAgentOutputSchema.parse({
          message: "今天的行程已完成，所有路段都已結束。",
          planningStatus: "ready",
          command: { action: "complete_navigation" },
        }),
      );
    }
    if (userMessage.includes("演唱會")) {
      return result(
        ConversationAgentOutputSchema.parse({
          message:
            "我先安排台北車站出發、下午咖啡，最後前往台北小巨蛋的演唱會，再安排回到起點。看起來行程沒問題了，等到行程當天按下開始行程就可以出發囉。",
          planningStatus: "ready",
          command: {
            action: "propose_day",
            date: itinerary.date,
            startAt: `${itinerary.date}T10:00:00+08:00`,
            endAt: `${itinerary.date}T22:00:00+08:00`,
            origin: taipeiStation,
            returnHome: true,
            profiles: ["car", "bike", "foot"],
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
    return result(
      ConversationAgentOutputSchema.parse({
        message: itinerary.stops.length
          ? "你可以告訴我想新增、移除或調整哪個行程。"
          : "請告訴我今天想去哪裡，以及有沒有固定時間的活動。",
        planningStatus: "needs_details",
        command: { action: "ask_clarification", question: "請提供今天想去的地點或固定活動。" },
      }),
    );
  }

  async draftNotification(input: NotificationAgentInput): Promise<NotificationAgentOutput> {
    return ItineraryNotificationSchema.parse({
      id: `fixture-notice-${Date.now()}`,
      kind: "service_disruption",
      severity: "warning",
      title: "行程路線需要更新",
      message: `目前狀況影響 ${input.affectedLegIds.length} 段路線，已重新計算替代方案。`,
      affectedLegIds: input.affectedLegIds,
      affectedStopIds: input.affectedStopIds,
      requiresConfirmation: false,
      evidenceIds: input.evidenceIds,
      createdAt: new Date().toISOString(),
    });
  }
}
