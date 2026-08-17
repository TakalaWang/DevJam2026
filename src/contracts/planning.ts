import { z } from "zod";
import { RoutePointSchema } from "./route";

export const PlanningFactStatusSchema = z.enum([
  "missing",
  "provided",
  "confirmed",
  "assumed",
]);
export type PlanningFactStatus = z.infer<typeof PlanningFactStatusSchema>;

export const TransportPreferenceSchema = z.enum([
  "car",
  "public_transit",
  "bike",
  "walk",
  "mixed",
  "no_preference",
]);
export type TransportPreference = z.infer<typeof TransportPreferenceSchema>;

export const PlanningPhaseSchema = z.enum([
  "collecting",
  "awaiting_confirmation",
  "scheduling",
  "refining",
]);
export type PlanningPhase = z.infer<typeof PlanningPhaseSchema>;

export const PlanningFieldSchema = z.enum([
  "origin",
  "destinations",
  "departure_at",
  "end_at",
  "fixed_activities",
  "transport_preference",
  "return_plan",
  "constraints",
  "user_confirmation",
]);
export type PlanningField = z.infer<typeof PlanningFieldSchema>;

const FactStatusSchema = z.object({ status: PlanningFactStatusSchema });
const TimestampSchema = z.string().datetime({ offset: true });

const PointFactSchema = FactStatusSchema.extend({ value: RoutePointSchema.optional() });
const StringListFactSchema = FactStatusSchema.extend({
  value: z.array(z.string().min(1)).min(1).optional(),
});
const TimestampFactSchema = FactStatusSchema.extend({ value: TimestampSchema.optional() });
const FixedActivitySchema = z.object({
  title: z.string().min(1),
  startAt: TimestampSchema,
  endAt: TimestampSchema,
});
const FixedActivitiesFactSchema = FactStatusSchema.extend({
  value: z.array(FixedActivitySchema).optional(),
});
const TransportFactSchema = FactStatusSchema.extend({
  value: TransportPreferenceSchema.optional(),
});
const ReturnPlanSchema = z.object({
  returnHome: z.boolean(),
  location: RoutePointSchema.optional(),
});
const ReturnPlanFactSchema = FactStatusSchema.extend({ value: ReturnPlanSchema.optional() });
const ConstraintFactSchema = FactStatusSchema.extend({
  value: z.array(z.string().min(1)).optional(),
});

export const PlanningFactsSchema = z
  .object({
    origin: PointFactSchema,
    destinations: StringListFactSchema,
    departureAt: TimestampFactSchema,
    endAt: TimestampFactSchema,
    fixedActivities: FixedActivitiesFactSchema,
    transportPreference: TransportFactSchema,
    returnPlan: ReturnPlanFactSchema,
    constraints: ConstraintFactSchema,
    assumptions: z.array(z.string().min(1)),
    confirmation: z.enum(["not_requested", "pending", "confirmed"]),
  })
  .superRefine((facts, context) => {
    const requiredValues: Array<{
      path: string;
      status: PlanningFactStatus;
      hasValue: boolean;
    }> = [
      { path: "origin", status: facts.origin.status, hasValue: Boolean(facts.origin.value) },
      {
        path: "destinations",
        status: facts.destinations.status,
        hasValue: Boolean(facts.destinations.value?.length),
      },
      {
        path: "departureAt",
        status: facts.departureAt.status,
        hasValue: Boolean(facts.departureAt.value),
      },
      { path: "endAt", status: facts.endAt.status, hasValue: Boolean(facts.endAt.value) },
      {
        path: "fixedActivities",
        status: facts.fixedActivities.status,
        hasValue: facts.fixedActivities.value !== undefined,
      },
      {
        path: "transportPreference",
        status: facts.transportPreference.status,
        hasValue: Boolean(facts.transportPreference.value),
      },
      {
        path: "returnPlan",
        status: facts.returnPlan.status,
        hasValue: Boolean(facts.returnPlan.value),
      },
      {
        path: "constraints",
        status: facts.constraints.status,
        hasValue: facts.constraints.value !== undefined,
      },
    ];
    for (const fact of requiredValues) {
      if (fact.status !== "missing" && !fact.hasValue) {
        context.addIssue({
          code: "custom",
          path: [fact.path, "value"],
          message: "非 missing 的規劃資料必須提供 value",
        });
      }
    }
    if (
      facts.returnPlan.value?.returnHome &&
      !facts.returnPlan.value.location &&
      facts.origin.value === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["returnPlan", "value", "location"],
        message: "需要回家但沒有回程位置",
      });
    }
  });
export type PlanningFacts = z.infer<typeof PlanningFactsSchema>;

export const EmptyPlanningFacts = {
  origin: { status: "missing" as const },
  destinations: { status: "missing" as const },
  departureAt: { status: "missing" as const },
  endAt: { status: "missing" as const },
  fixedActivities: { status: "missing" as const },
  transportPreference: { status: "missing" as const },
  returnPlan: { status: "missing" as const },
  constraints: { status: "missing" as const },
  assumptions: [],
  confirmation: "not_requested" as const,
};

export const PlanningReadinessSchema = z.object({
  ready: z.boolean(),
  missingFields: z.array(PlanningFieldSchema),
  assumptions: z.array(z.string().min(1)),
});
export type PlanningReadiness = z.infer<typeof PlanningReadinessSchema>;
