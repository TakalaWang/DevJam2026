import { describe, expect, it } from "vitest";
import {
  EmptyPlanningFacts,
  PlanningFactsSchema,
  PlanningReadinessSchema,
  TransportPreferenceSchema,
} from "../src/contracts";

describe("planning facts contracts", () => {
  it("provides an explicit empty collection state", () => {
    const facts = PlanningFactsSchema.parse(EmptyPlanningFacts);

    expect(facts.origin.status).toBe("missing");
    expect(facts.transportPreference.status).toBe("missing");
    expect(facts.confirmation).toBe("not_requested");
  });

  it("accepts confirmed travel requirements", () => {
    const facts = PlanningFactsSchema.parse({
      origin: {
        status: "confirmed",
        value: { label: "台北車站", coordinate: { latitude: 25.0478, longitude: 121.517 } },
      },
      destinations: { status: "confirmed", value: ["台北小巨蛋"] },
      departureAt: { status: "confirmed", value: "2026-08-17T13:00:00+08:00" },
      endAt: { status: "confirmed", value: "2026-08-17T22:00:00+08:00" },
      fixedActivities: { status: "confirmed", value: [] },
      transportPreference: { status: "confirmed", value: "public_transit" },
      returnPlan: {
        status: "confirmed",
        value: {
          returnHome: true,
          location: { label: "台北車站", coordinate: { latitude: 25.0478, longitude: 121.517 } },
        },
      },
      constraints: { status: "confirmed", value: [] },
      assumptions: [],
      confirmation: "confirmed",
    });

    expect(facts.transportPreference.value).toBe("public_transit");
  });

  it("rejects a fact marked confirmed without a value", () => {
    expect(() =>
      PlanningFactsSchema.parse({
        ...EmptyPlanningFacts,
        transportPreference: { status: "confirmed" },
      }),
    ).toThrow();
  });

  it("keeps the readiness result typed", () => {
    expect(
      PlanningReadinessSchema.parse({
        ready: false,
        missingFields: ["transport_preference"],
        assumptions: ["尚未確認交通方式"],
      }).missingFields,
    ).toEqual(["transport_preference"]);
    expect(TransportPreferenceSchema.parse("mixed")).toBe("mixed");
  });
});
