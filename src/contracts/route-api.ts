import { z } from "zod";
import { RoutePlanSchema, RouteRequestSchema, RouteRunSchema, RouteSessionSchema, RouteSignalSchema } from "./route";

export const CreateRouteRequestSchema = z.object({
  userId: z.string().min(1).max(200).default("anonymous"),
  request: RouteRequestSchema,
  signals: z.array(RouteSignalSchema).default([]),
});
export type CreateRouteRequest = z.infer<typeof CreateRouteRequestSchema>;

export const ReplanRouteRequestSchema = z.object({
  signals: z.array(RouteSignalSchema).default([]),
});
export type ReplanRouteRequest = z.infer<typeof ReplanRouteRequestSchema>;

export const RouteResponseSchema = z.object({
  session: RouteSessionSchema,
  lastRun: RouteRunSchema.optional(),
});
export type RouteResponse = z.infer<typeof RouteResponseSchema>;

export const RoutePlanResponseSchema = z.object({ plan: RoutePlanSchema });
export type RoutePlanResponse = z.infer<typeof RoutePlanResponseSchema>;
