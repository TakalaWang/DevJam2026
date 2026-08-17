import { z } from "zod";
import { RoutePointSchema, RouteRequestSchema, RouteSignalSchema, RoutePathSchema } from "./route";
import { EmptyPlanningFacts, PlanningFactsSchema, PlanningPhaseSchema } from "./planning";

export const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須是 YYYY-MM-DD");
export const ItineraryTimestampSchema = z.string().datetime({ offset: true });

export const ItineraryStopConstraintSchema = z.enum(["fixed", "flexible"]);
export const ItineraryStopStatusSchema = z.enum(["planned", "visited", "skipped", "needs_review"]);

export const ItineraryStopDraftSchema = z.object({
  title: z.string().min(1),
  location: RoutePointSchema,
  durationMinutes: z.number().int().min(1),
  constraint: ItineraryStopConstraintSchema,
  timeWindow: z
    .object({ startAt: ItineraryTimestampSchema, endAt: ItineraryTimestampSchema })
    .optional(),
  evidenceIds: z.array(z.string().min(1)).default([]),
});
export type ItineraryStopDraft = z.infer<typeof ItineraryStopDraftSchema>;

export const ItineraryStopSchema = ItineraryStopDraftSchema.extend({
  id: z.string().min(1),
  status: ItineraryStopStatusSchema,
});
export type ItineraryStop = z.infer<typeof ItineraryStopSchema>;

const TravelLegBaseSchema = {
  id: z.string().min(1),
  fromStopId: z.string().min(1),
  toStopId: z.string().min(1),
  checkedAt: ItineraryTimestampSchema,
  evidenceIds: z.array(z.string().min(1)),
};

export const TravelLegSchema = z.discriminatedUnion("status", [
  z.object({
    ...TravelLegBaseSchema,
    status: z.enum(["planned", "active", "completed"]),
    route: RoutePathSchema,
  }),
  z.object({
    ...TravelLegBaseSchema,
    status: z.literal("blocked"),
    route: RoutePathSchema.optional(),
    reason: z.string().min(1),
  }),
]);
export type TravelLeg = z.infer<typeof TravelLegSchema>;

export const ItineraryCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("propose_day"),
    date: CalendarDateSchema,
    startAt: ItineraryTimestampSchema,
    endAt: ItineraryTimestampSchema,
    origin: RoutePointSchema,
    returnHome: z.boolean(),
    profiles: RouteRequestSchema.shape.profiles,
    stops: z.array(ItineraryStopDraftSchema).min(1),
  }),
  z.object({
    action: z.literal("add_stop"),
    stop: ItineraryStopDraftSchema,
    afterStopId: z.string().min(1).optional(),
  }),
  z.object({ action: z.literal("remove_stop"), stopId: z.string().min(1) }),
  z.object({
    action: z.literal("move_stop"),
    stopId: z.string().min(1),
    afterStopId: z.string().min(1).optional(),
    timeWindow: z
      .object({ startAt: ItineraryTimestampSchema, endAt: ItineraryTimestampSchema })
      .optional(),
  }),
  z.object({ action: z.literal("start_navigation") }),
  z.object({ action: z.literal("complete_navigation") }),
  z.object({ action: z.literal("ack_notification"), notificationId: z.string().min(1) }),
  z.object({ action: z.literal("ask_clarification"), question: z.string().min(1) }),
]);
export type ItineraryCommand = z.infer<typeof ItineraryCommandSchema>;

const ItineraryLegStateSchema = z.object({
  status: z.enum(["planned", "active", "completed", "blocked"]),
  provider: z.literal("google").optional(),
  profile: z.enum(["car", "transit", "bike", "foot"]).optional(),
  routeId: z.string().min(1).optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  distanceMeters: z.number().nonnegative().optional(),
  reason: z.string().min(1).optional(),
});
export type ItineraryLegState = z.infer<typeof ItineraryLegStateSchema>;

export const ItineraryRouteChangeSchema = z.object({
  legId: z.string().min(1),
  fromStopId: z.string().min(1),
  toStopId: z.string().min(1),
  fromLabel: z.string().min(1),
  toLabel: z.string().min(1),
  before: ItineraryLegStateSchema,
  after: ItineraryLegStateSchema,
  delta: z.object({
    durationSeconds: z.number().int(),
    distanceMeters: z.number(),
  }),
  reason: z.string().min(1),
  tradeoffs: z.array(z.string().min(1)),
});
export type ItineraryRouteChange = z.infer<typeof ItineraryRouteChangeSchema>;

export const ItineraryNotificationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["route_changed", "service_disruption", "confirmation_required"]),
  severity: z.enum(["info", "warning", "critical"]),
  title: z.string().min(1),
  message: z.string().min(1),
  affectedLegIds: z.array(z.string().min(1)),
  affectedStopIds: z.array(z.string().min(1)),
  changes: z.array(ItineraryRouteChangeSchema).min(1),
  requiresConfirmation: z.boolean(),
  evidenceIds: z.array(z.string().min(1)),
  createdAt: ItineraryTimestampSchema,
  readAt: ItineraryTimestampSchema.optional(),
});
export type ItineraryNotification = z.infer<typeof ItineraryNotificationSchema>;

export const DayItineraryStatusSchema = z.enum([
  "discussing",
  "ready",
  "active",
  "completed",
  "update_pending",
]);
export const DayItinerarySnapshotSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    status: DayItineraryStatusSchema,
    revision: z.number().int().nonnegative(),
    date: CalendarDateSchema,
    planningPhase: PlanningPhaseSchema.default("collecting"),
    planningFacts: PlanningFactsSchema.default(EmptyPlanningFacts),
    startAt: ItineraryTimestampSchema.optional(),
    endAt: ItineraryTimestampSchema.optional(),
    origin: RoutePointSchema.optional(),
    returnHome: z.boolean(),
    profiles: RouteRequestSchema.shape.profiles,
    stops: z.array(ItineraryStopSchema),
    legs: z.array(TravelLegSchema),
    currentStopId: z.string().min(1).optional(),
    currentLocation: RoutePointSchema.optional(),
    signals: z.array(RouteSignalSchema),
    notifications: z.array(ItineraryNotificationSchema),
    createdAt: ItineraryTimestampSchema,
    updatedAt: ItineraryTimestampSchema,
  })
  .superRefine((snapshot, context) => {
    if (
      ["ready", "active", "completed", "update_pending"].includes(snapshot.status) &&
      snapshot.stops.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["stops"],
        message: "已建立的行程至少需要一個景點",
      });
    }
    if (
      snapshot.currentStopId &&
      !snapshot.stops.some((stop) => stop.id === snapshot.currentStopId)
    ) {
      context.addIssue({ code: "custom", path: ["currentStopId"], message: "目前景點不存在" });
    }
  });
export type DayItinerarySnapshot = z.infer<typeof DayItinerarySnapshotSchema>;

export const ItineraryUpdateSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  kind: z.enum(["route_changed", "service_disruption", "confirmation_required"]),
  affectedLegIds: z.array(z.string().min(1)),
  affectedStopIds: z.array(z.string().min(1)),
  notificationId: z.string().min(1),
  requiresConfirmation: z.boolean(),
  createdAt: ItineraryTimestampSchema,
});
export type ItineraryUpdate = z.infer<typeof ItineraryUpdateSchema>;
