import {
  ConversationAgentInputSchema,
  ConversationAgentOutputSchema,
  ConversationAgentResultSchema,
  NotificationAgentInputSchema,
  NotificationAgentOutputSchema,
  type ConversationAgentOutput,
  type ConversationAgentResult,
  type DayItinerarySnapshot,
  type NotificationAgentInput,
  type NotificationAgentOutput,
} from "../../contracts";

export class ConversationAgentOutputInvalidError extends Error {
  readonly code = "agent_output_invalid" as const;
}

export class ConversationAgentUnavailableError extends Error {
  readonly code = "agent_unavailable" as const;
}

export interface ItineraryAgent {
  interpret(
    itinerary: DayItinerarySnapshot,
    userMessage: string,
    previousInteractionId?: string,
  ): Promise<ConversationAgentResult>;
  draftNotification(input: NotificationAgentInput): Promise<NotificationAgentOutput>;
}

export class UnavailableItineraryAgent implements ItineraryAgent {
  constructor(private readonly reason: string) {}

  async interpret(): Promise<ConversationAgentResult> {
    throw new ConversationAgentUnavailableError(this.reason);
  }

  async draftNotification(): Promise<NotificationAgentOutput> {
    throw new ConversationAgentUnavailableError(this.reason);
  }
}

export function parseConversationOutput(output: ConversationAgentOutput): ConversationAgentOutput {
  return ConversationAgentOutputSchema.parse(output);
}

export function parseConversationResult(result: ConversationAgentResult): ConversationAgentResult {
  return ConversationAgentResultSchema.parse(result);
}

export function parseNotificationOutput(output: NotificationAgentOutput): NotificationAgentOutput {
  return NotificationAgentOutputSchema.parse(output);
}

export function conversationInput(itinerary: DayItinerarySnapshot, userMessage: string) {
  return ConversationAgentInputSchema.parse({ itinerary, userMessage });
}

export function notificationInput(input: NotificationAgentInput): NotificationAgentInput {
  return NotificationAgentInputSchema.parse(input);
}
