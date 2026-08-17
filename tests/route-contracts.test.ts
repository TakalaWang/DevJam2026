import { describe, expect, it } from "vitest";
import { RoutePlanSchema, RouteRequestSchema, RouteSignalSchema } from "../src/contracts";

const point = (label: string, latitude: number, longitude: number) => ({
  label,
  coordinate: { latitude, longitude },
});

const request = {
  origin: point("A", 25.0478, 121.517),
  destination: point("B", 25.033, 121.5654),
  profiles: ["car", "bike", "foot"],
  bikeStations: [],
};

describe("route contracts", () => {
  it("parses an A-to-B request with route profiles", () => {
    expect(RouteRequestSchema.parse(request).profiles).toEqual(["car", "bike", "foot"]);
  });

  it("rejects invalid coordinates", () => {
    expect(() =>
      RouteRequestSchema.parse({
        ...request,
        origin: point("A", 95, 121.517),
      }),
    ).toThrow();
  });

  it("parses disruption signals as a discriminated union", () => {
    const signal = RouteSignalSchema.parse({
      id: "flood-1",
      kind: "flood_zone",
      label: "模擬淹水區",
      polygon: [
        { latitude: 25.04, longitude: 121.52 },
        { latitude: 25.04, longitude: 121.53 },
        { latitude: 25.03, longitude: 121.53 },
        { latitude: 25.03, longitude: 121.52 },
        { latitude: 25.04, longitude: 121.52 },
      ],
      severity: "blocked",
      observedAt: "2026-08-17T08:00:00+08:00",
      evidenceId: "evidence-flood-1",
      summary: "道路積水，禁止通行",
    });
    expect(signal.kind).toBe("flood_zone");
  });

  it("parses a no-safe-route plan", () => {
    const plan = RoutePlanSchema.parse({
      id: "plan-1",
      status: "no_safe_route",
      request: RouteRequestSchema.parse(request),
      evaluations: [],
      signals: [],
      generatedAt: "2026-08-17T08:00:00+08:00",
      evidenceIds: [],
      reason: "所有候選路線都穿過封閉區域",
    });
    expect(plan.status).toBe("no_safe_route");
  });
});
