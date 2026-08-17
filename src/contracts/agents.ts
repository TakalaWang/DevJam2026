import { z } from "zod";
import {
  ActivitySchema,
  DayPlanSchema,
  ScheduleItemSchema,
  TravelCandidateSchema,
  TripSnapshotSchema,
  EvidenceSchema,
  SearchEvidenceSchema,
} from "./trip";

export const AgentNameSchema = z.enum([
  "travel_boundary",
  "daily_frame",
  "activity_discovery",
  "schedule",
  "item_review",
  "daily_review",
]);
export type AgentName = z.infer<typeof AgentNameSchema>;

export const AgentInputSchema = z.object({
  tripId: z.string().min(1),
  userMessage: z.string(),
  snapshot: TripSnapshotSchema,
  correction: z.string().optional(),
});
export type AgentInput = z.infer<typeof AgentInputSchema>;

const AgentMessageSchema = z.object({
  message: z.string(),
  evidenceIds: z.array(z.string().min(1)).default([]),
  evidence: z.array(EvidenceSchema).default([]),
});
export const ActivitySearchResearchOutputSchema = z.object({
  message: z.string(),
  evidenceIds: z.array(z.string().min(1)).default([]),
  evidence: z.array(SearchEvidenceSchema).default([]),
});
export type ActivitySearchResearchOutput = z.infer<typeof ActivitySearchResearchOutputSchema>;
export const AdkSessionStateSchema = z.object({ workflow_input: AgentInputSchema });

export const TravelAgentOutputSchema = z.discriminatedUnion("action", [
  AgentMessageSchema.extend({ action: z.literal("ask_user") }),
  AgentMessageSchema.extend({
    action: z.literal("present_candidates"),
    candidates: z.array(TravelCandidateSchema),
  }),
  AgentMessageSchema.extend({
    action: z.literal("complete"),
    candidates: z.array(TravelCandidateSchema).default([]),
  }),
]);
export type TravelAgentOutput = z.infer<typeof TravelAgentOutputSchema>;

export const DailyFrameAgentOutputSchema = z.discriminatedUnion("action", [
  AgentMessageSchema.extend({ action: z.literal("ask_user") }),
  AgentMessageSchema.extend({ action: z.literal("save_frame"), days: z.array(DayPlanSchema) }),
  AgentMessageSchema.extend({ action: z.literal("complete"), days: z.array(DayPlanSchema) }),
]);
export type DailyFrameAgentOutput = z.infer<typeof DailyFrameAgentOutputSchema>;

export const ActivityDiscoveryAgentOutputSchema = z.discriminatedUnion("action", [
  AgentMessageSchema.extend({ action: z.literal("ask_user") }),
  AgentMessageSchema.extend({
    action: z.literal("save_activities"),
    activities: z.array(ActivitySchema),
  }),
  AgentMessageSchema.extend({ action: z.literal("complete"), activities: z.array(ActivitySchema) }),
]);
export type ActivityDiscoveryAgentOutput = z.infer<typeof ActivityDiscoveryAgentOutputSchema>;

export const ScheduleAgentOutputSchema = z.discriminatedUnion("action", [
  AgentMessageSchema.extend({ action: z.literal("ask_user") }),
  AgentMessageSchema.extend({
    action: z.literal("insert"),
    targetActivityId: z.string().min(1),
    proposedScheduleItem: ScheduleItemSchema,
  }),
  AgentMessageSchema.extend({
    action: z.literal("move"),
    targetActivityId: z.string().min(1),
    proposedScheduleItem: ScheduleItemSchema,
  }),
  AgentMessageSchema.extend({ action: z.literal("remove"), targetActivityId: z.string().min(1) }),
  AgentMessageSchema.extend({ action: z.literal("complete") }),
]);
export type ScheduleAgentOutput = z.infer<typeof ScheduleAgentOutputSchema>;

export const ReviewFindingSchema = z.object({
  severity: z.enum(["info", "warning", "error"]),
  code: z.enum([
    "invalid_time",
    "time_conflict",
    "closed",
    "travel_too_long",
    "insufficient_buffer",
    "pace",
    "unverified",
    "preference",
  ]),
  targetId: z.string().min(1),
  message: z.string().min(1),
  suggestedChange: z.string().min(1).optional(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const ItemReviewAgentOutputSchema = AgentMessageSchema.extend({
  decision: z.enum(["approved", "rejected", "unverified"]),
  findings: z.array(ReviewFindingSchema),
  suggestedChanges: z.array(z.string().min(1)),
});
export type ItemReviewAgentOutput = z.infer<typeof ItemReviewAgentOutputSchema>;

export const DailyReviewAgentOutputSchema = AgentMessageSchema.extend({
  decision: z.enum(["approved", "rejected", "needs_user"]),
  findings: z.array(ReviewFindingSchema),
  dayScore: z.number().min(0).max(100),
});
export type DailyReviewAgentOutput = z.infer<typeof DailyReviewAgentOutputSchema>;

export const AdkOutputSchemas = {
  travel_boundary: z.object({
    action: z.enum(["ask_user", "present_candidates", "complete"]),
    message: z.string(),
    evidenceIds: z.array(z.string()).default([]),
    evidence: z.array(EvidenceSchema).default([]),
    candidates: z.array(TravelCandidateSchema).optional(),
  }),
  daily_frame: z.object({
    action: z.enum(["ask_user", "save_frame", "complete"]),
    message: z.string(),
    evidenceIds: z.array(z.string()).default([]),
    evidence: z.array(EvidenceSchema).default([]),
    days: z.array(DayPlanSchema).optional(),
  }),
  activity_discovery: z.object({
    action: z.enum(["ask_user", "save_activities", "complete"]),
    message: z.string(),
    evidenceIds: z.array(z.string()).default([]),
    evidence: z.array(EvidenceSchema).default([]),
    activities: z.array(ActivitySchema).optional(),
  }),
  schedule: z.object({
    action: z.enum(["ask_user", "insert", "move", "remove", "complete"]),
    message: z.string(),
    evidenceIds: z.array(z.string()).default([]),
    evidence: z.array(EvidenceSchema).default([]),
    targetActivityId: z.string().optional(),
    proposedScheduleItem: ScheduleItemSchema.optional(),
  }),
  item_review: ItemReviewAgentOutputSchema,
  daily_review: DailyReviewAgentOutputSchema,
} as const;

export const ValidatorResultSchema = z.object({
  valid: z.boolean(),
  findings: z.array(ReviewFindingSchema),
});
export type ValidatorResult = z.infer<typeof ValidatorResultSchema>;

export const AgentOutputSchemas = {
  travel_boundary: TravelAgentOutputSchema,
  daily_frame: DailyFrameAgentOutputSchema,
  activity_discovery: ActivityDiscoveryAgentOutputSchema,
  schedule: ScheduleAgentOutputSchema,
  item_review: ItemReviewAgentOutputSchema,
  daily_review: DailyReviewAgentOutputSchema,
} as const;
