import { z } from "zod";
import { ConversationRunSchema } from "./conversation";
import {
  CalendarDateSchema,
  DayItinerarySnapshotSchema,
  DayItineraryStatusSchema,
  ItineraryNotificationSchema,
} from "./itinerary";
import { RouteSignalSchema } from "./route";

export const CreateDayItineraryRequestSchema = z.object({
  userId: z.string().min(1).max(200).default("anonymous"),
  date: CalendarDateSchema,
});
export type CreateDayItineraryRequest = z.infer<typeof CreateDayItineraryRequestSchema>;

export const ListDayItinerariesQuerySchema = z.object({
  userId: z.string().min(1).max(200).default("anonymous"),
});
export type ListDayItinerariesQuery = z.infer<typeof ListDayItinerariesQuerySchema>;

export const MessageRequestSchema = z.object({ message: z.string().trim().min(1).max(4_000) });
export type MessageRequest = z.infer<typeof MessageRequestSchema>;

export const RefreshRequestSchema = z.object({ signals: z.array(RouteSignalSchema).default([]) });
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const DemoScenarioSchema = z.enum([
  "flood",
  "road_closure",
  "station_disruption",
  "bike_unavailable",
]);
export type DemoScenario = z.infer<typeof DemoScenarioSchema>;

export const DemoRefreshRequestSchema = z.object({ scenario: DemoScenarioSchema });
export type DemoRefreshRequest = z.infer<typeof DemoRefreshRequestSchema>;

export const DayItinerarySummarySchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  status: DayItineraryStatusSchema,
  revision: z.number().int().nonnegative(),
  date: CalendarDateSchema,
  stopCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime({ offset: true }),
});
export type DayItinerarySummary = z.infer<typeof DayItinerarySummarySchema>;

export const DayItineraryResponseSchema = z.object({
  itinerary: DayItinerarySnapshotSchema,
  runs: z.array(ConversationRunSchema).default([]),
  lastRun: ConversationRunSchema.optional(),
  assistantMessage: z.string().optional(),
  notification: ItineraryNotificationSchema.optional(),
});
export type DayItineraryResponse = z.infer<typeof DayItineraryResponseSchema>;

export const DayItineraryListResponseSchema = z.object({
  itineraries: z.array(DayItinerarySummarySchema),
});
export type DayItineraryListResponse = z.infer<typeof DayItineraryListResponseSchema>;

export const DeleteDayItineraryResponseSchema = z.object({
  id: z.string().min(1),
  deleted: z.literal(true),
});
export type DeleteDayItineraryResponse = z.infer<typeof DeleteDayItineraryResponseSchema>;

export const NotificationListResponseSchema = z.object({
  notifications: z.array(DayItinerarySnapshotSchema.shape.notifications.element),
});
