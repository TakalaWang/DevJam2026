import { z } from "zod";

export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須是 YYYY-MM-DD");
export const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時間格式必須是 HH:MM");
export const DateTimeSchema = z.string().min(1);

export const EvidenceKindSchema = z.enum(["search", "route", "place", "flight", "lodging"]);
export const EvidenceSchema = z.object({
  id: z.string().min(1),
  kind: EvidenceKindSchema,
  source: z.string().min(1),
  fetchedAt: z.string().datetime({ offset: true }),
  summary: z.string().min(1),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const SearchEvidenceSchema = EvidenceSchema.extend({
  kind: z.literal("search"),
  query: z.string().min(1),
  sourceUrls: z.array(z.string().url()),
});
export type SearchEvidence = z.infer<typeof SearchEvidenceSchema>;

export const FlightCandidateSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("flight"),
  provider: z.string().min(1),
  airline: z.string().min(1),
  flightNumber: z.string().min(1),
  origin: z.string().min(1),
  destination: z.string().min(1),
  departureAt: DateTimeSchema,
  arrivalAt: DateTimeSchema,
  priceTwd: z.number().nonnegative().optional(),
  evidenceIds: z.array(z.string().min(1)).min(1),
});
export type FlightCandidate = z.infer<typeof FlightCandidateSchema>;

export const LodgingCandidateSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("lodging"),
  provider: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  checkIn: DateSchema,
  checkOut: DateSchema,
  pricePerNightTwd: z.number().nonnegative().optional(),
  evidenceIds: z.array(z.string().min(1)).min(1),
});
export type LodgingCandidate = z.infer<typeof LodgingCandidateSchema>;

export const TravelCandidateSchema = z.discriminatedUnion("kind", [
  FlightCandidateSchema,
  LodgingCandidateSchema,
]);
export type TravelCandidate = z.infer<typeof TravelCandidateSchema>;

export const TravelerProfileSchema = z.object({
  partySize: z.number().int().min(1).optional(),
  pace: z.enum(["relaxed", "balanced", "dense"]).default("balanced"),
  mobility: z.enum(["standard", "low_walking", "accessible"]).default("standard"),
  transport: z.enum(["public_transit", "drive", "mixed"]).default("mixed"),
  dietaryNotes: z.string().optional(),
  budgetTwd: z.number().nonnegative().optional(),
});
export type TravelerProfile = z.infer<typeof TravelerProfileSchema>;

export const SlotKindSchema = z.enum(["sleep", "wake", "meal", "rest", "buffer", "custom"]);
export const SlotConstraintSchema = z.enum(["hard", "soft"]);
export const SlotSchema = z.object({
  id: z.string().min(1),
  kind: SlotKindSchema,
  label: z.string().min(1),
  start: TimeSchema,
  end: TimeSchema,
  constraint: SlotConstraintSchema,
  enabled: z.boolean().default(true),
});
export type Slot = z.infer<typeof SlotSchema>;

export const ActivityStatusSchema = z.enum(["suggested", "confirmed", "rejected", "stale"]);
export const ActivitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  location: z.string().min(1),
  durationMinutes: z.number().int().min(1),
  status: ActivityStatusSchema,
  fixedStart: DateTimeSchema.optional(),
  priority: z.enum(["must", "preferred", "suggested"]).default("suggested"),
  evidenceIds: z.array(z.string().min(1)).default([]),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const ScheduleItemSchema = z.object({
  id: z.string().min(1),
  activityId: z.string().min(1),
  location: z.string().min(1),
  start: DateTimeSchema,
  end: DateTimeSchema,
  status: z.enum(["draft", "approved", "stale"]),
  routeEvidenceId: z.string().min(1).optional(),
  placeEvidenceId: z.string().min(1).optional(),
});
export type ScheduleItem = z.infer<typeof ScheduleItemSchema>;

export const DayPlanSchema = z.object({
  date: DateSchema,
  base: z.string().min(1).optional(),
  slots: z.array(SlotSchema),
  activities: z.array(ActivitySchema),
  schedule: z.array(ScheduleItemSchema),
  reviewStatus: z.enum(["pending", "reviewing", "approved", "stale"]).default("pending"),
});
export type DayPlan = z.infer<typeof DayPlanSchema>;

export const TripStatusSchema = z.enum([
  "intake",
  "flight_confirmation",
  "lodging_confirmation",
  "slot_confirmation",
  "preference_confirmation",
  "scheduling_day",
  "item_review",
  "daily_review",
  "cross_day_validation",
  "awaiting_user_confirmation",
  "final",
  "blocked",
]);
export type TripStatus = z.infer<typeof TripStatusSchema>;

export const TripSnapshotSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  status: TripStatusSchema,
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  profile: TravelerProfileSchema,
  travelCandidates: z.array(TravelCandidateSchema),
  confirmedFlightId: z.string().min(1).optional(),
  confirmedLodgingId: z.string().min(1).optional(),
  days: z.array(DayPlanSchema),
  currentDayIndex: z.number().int().nonnegative(),
  evidence: z.array(EvidenceSchema),
  reviewAttempts: z.record(z.string().min(1), z.number().int().nonnegative()).default({}),
  pendingQuestion: z.string().optional(),
  lastError: z.string().optional(),
});
export type TripSnapshot = z.infer<typeof TripSnapshotSchema>;
