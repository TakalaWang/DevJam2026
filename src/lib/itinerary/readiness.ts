import {
  PlanningFactsSchema,
  PlanningReadinessSchema,
  type PlanningFacts,
  type PlanningField,
} from "../../contracts";

export function hasExplicitConfirmation(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized || /不確定|不要確認|先不用|還要改|再看看/.test(normalized)) return false;
  return /確認|沒問題|沒有問題|可以|對的|正確|就這樣|ok|okay/.test(normalized);
}

export function hasCollectedPlanningFacts(rawFacts: PlanningFacts): boolean {
  const facts = PlanningFactsSchema.parse(rawFacts);
  return [
    facts.origin.value,
    facts.destinations.value?.length,
    facts.departureAt.value,
    facts.endAt.value,
    facts.fixedActivities.value,
    facts.transportPreference.value,
    facts.returnPlan.value,
  ].every(Boolean);
}

export function assessPlanningReadiness(rawFacts: PlanningFacts) {
  const facts = PlanningFactsSchema.parse(rawFacts);
  const fields: Array<{ field: PlanningField; status: PlanningFacts["origin"]["status"] }> = [
    { field: "origin", status: facts.origin.status },
    { field: "destinations", status: facts.destinations.status },
    { field: "departure_at", status: facts.departureAt.status },
    { field: "end_at", status: facts.endAt.status },
    { field: "transport_preference", status: facts.transportPreference.status },
    { field: "return_plan", status: facts.returnPlan.status },
  ];
  const missingFields = fields
    .filter((field) => field.status !== "confirmed")
    .map((field) => field.field);
  if (facts.confirmation !== "confirmed") missingFields.push("user_confirmation");
  return PlanningReadinessSchema.parse({
    ready: missingFields.length === 0,
    missingFields,
    assumptions: facts.assumptions,
  });
}
