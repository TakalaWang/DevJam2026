import { z } from "zod";
import { AgentNameSchema } from "./agents";
import { TripSnapshotSchema } from "./trip";

export const CreateTripRequestSchema = z.object({
  userId: z.string().min(1).max(200).default("anonymous"),
});
export type CreateTripRequest = z.infer<typeof CreateTripRequestSchema>;

export const TripInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), message: z.string().trim().min(1).max(4_000) }),
  z.object({ type: z.literal("confirm_flight"), candidateId: z.string().min(1) }),
  z.object({ type: z.literal("confirm_lodging"), candidateId: z.string().min(1) }),
  z.object({ type: z.literal("confirm_plan") }),
  z.object({ type: z.literal("accept_activity"), activityId: z.string().min(1) }),
  z.object({ type: z.literal("reject_activity"), activityId: z.string().min(1) }),
]);
export type TripInput = z.infer<typeof TripInputSchema>;

export const UserTurnResultSchema = z.object({
  kind: z.enum(["question", "proposal", "progress", "error", "final"]),
  message: z.string(),
  options: z.array(z.string()).default([]),
  stateTransition: z.string().min(1).optional(),
});
export type UserTurnResult = z.infer<typeof UserTurnResultSchema>;
export type UserTurnInput = z.input<typeof UserTurnResultSchema>;

export const RunStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);
export const RunErrorSchema = z.object({
  code: z.enum(["agent_output_invalid", "agent_unavailable", "workflow_invalid", "not_found"]),
  message: z.string().min(1),
});
export const WorkflowEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("started"), at: z.string().datetime({ offset: true }) }),
  z.object({
    type: z.literal("succeeded"),
    at: z.string().datetime({ offset: true }),
    output: UserTurnResultSchema,
  }),
  z.object({
    type: z.literal("failed"),
    at: z.string().datetime({ offset: true }),
    error: RunErrorSchema,
  }),
]);
export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>;
export const AgentRunSchema = z.object({
  id: z.string().min(1),
  tripId: z.string().min(1),
  agent: AgentNameSchema.optional(),
  status: RunStatusSchema,
  inputType: z.string().min(1),
  output: UserTurnResultSchema.optional(),
  error: RunErrorSchema.optional(),
  events: z.array(WorkflowEventSchema).default([]),
  createdAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional(),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const TripResponseSchema = z.object({
  trip: TripSnapshotSchema,
  lastRun: AgentRunSchema.optional(),
});
export type TripResponse = z.infer<typeof TripResponseSchema>;

export const ApiErrorSchema = z.object({ error: z.string().min(1) });
