import { z } from "zod";
import {
  CalendarDateSchema,
  DayItinerarySnapshotSchema,
  ItineraryCommandSchema,
  ItineraryNotificationSchema,
  ItineraryStopDraftSchema,
  ItineraryTimestampSchema,
  ItineraryRouteChangeSchema,
} from "./itinerary";
import { RoutePointSchema, RouteProfileSchema } from "./route";

export const ConversationAgentInputSchema = z.object({
  itinerary: DayItinerarySnapshotSchema,
  userMessage: z.string().min(1),
});
export type ConversationAgentInput = z.infer<typeof ConversationAgentInputSchema>;

export const ConversationAgentOutputSchema = z.object({
  message: z.string().min(1),
  planningStatus: z.enum(["needs_details", "ready"]),
  command: ItineraryCommandSchema,
});
export type ConversationAgentOutput = z.infer<typeof ConversationAgentOutputSchema>;

const ConversationCommandModelSchema = z.object({
  action: z.enum([
    "propose_day",
    "add_stop",
    "remove_stop",
    "move_stop",
    "start_navigation",
    "complete_navigation",
    "ack_notification",
    "ask_clarification",
  ]),
  date: CalendarDateSchema.nullable(),
  startAt: ItineraryTimestampSchema.nullable(),
  endAt: ItineraryTimestampSchema.nullable(),
  origin: RoutePointSchema.nullable(),
  returnHome: z.boolean().nullable(),
  profiles: z.array(RouteProfileSchema).nullable(),
  stops: z.array(ItineraryStopDraftSchema).nullable(),
  stop: ItineraryStopDraftSchema.nullable(),
  afterStopId: z.string().min(1).nullable(),
  stopId: z.string().min(1).nullable(),
  timeWindow: z
    .object({ startAt: ItineraryTimestampSchema, endAt: ItineraryTimestampSchema })
    .nullable(),
  notificationId: z.string().min(1).nullable(),
  question: z.string().min(1).nullable(),
});

export const ConversationAgentModelOutputSchema = z.object({
  message: z.string().min(1),
  planningStatus: z.enum(["needs_details", "ready"]),
  command: ConversationCommandModelSchema,
});
export type ConversationAgentModelOutput = z.infer<typeof ConversationAgentModelOutputSchema>;

export const ConversationAgentResultSchema = z.object({
  output: ConversationAgentOutputSchema,
  interactionId: z.string().min(1),
});
export type ConversationAgentResult = z.infer<typeof ConversationAgentResultSchema>;

export const NotificationAgentInputSchema = z.object({
  currentStatus: z.string().min(1),
  affectedLegIds: z.array(z.string().min(1)),
  affectedStopIds: z.array(z.string().min(1)),
  reasonCodes: z.array(z.string().min(1)),
  evidenceIds: z.array(z.string().min(1)),
  changes: z.array(ItineraryRouteChangeSchema).min(1),
});
export type NotificationAgentInput = z.infer<typeof NotificationAgentInputSchema>;

export const NotificationAgentOutputSchema = ItineraryNotificationSchema;
export type NotificationAgentOutput = z.infer<typeof NotificationAgentOutputSchema>;

export const ConversationRunSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  userMessage: z.string().min(1),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  interactionId: z.string().min(1).optional(),
  output: ConversationAgentOutputSchema.optional(),
  notification: NotificationAgentOutputSchema.optional(),
  error: z
    .object({
      code: z.enum(["agent_output_invalid", "agent_unavailable", "workflow_invalid"]),
      message: z.string().min(1),
    })
    .optional(),
  createdAt: ItineraryTimestampSchema,
  completedAt: ItineraryTimestampSchema.optional(),
});
export type ConversationRun = z.infer<typeof ConversationRunSchema>;
