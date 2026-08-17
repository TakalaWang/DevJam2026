import { describe, expect, it } from "vitest";
import { GoogleRoutesProvider } from "../src/lib/routing/google";

const request = {
  origin: { label: "A", coordinate: { latitude: 25.04, longitude: 121.5 } },
  destination: { label: "B", coordinate: { latitude: 25.05, longitude: 121.51 } },
  profiles: ["car" as const],
  maxExtraMinutes: 20,
  bikeStations: [],
};

describe("Google Routes provider", () => {
  it("maps traffic-aware routes into the shared typed path", async () => {
    let body = "";
    const provider = new GoogleRoutesProvider({
      apiKey: "test-key",
      baseUrl: "https://routes.test/directions/v2:computeRoutes",
      fetchImpl: async (_input, init) => {
        body = String(init?.body);
        return new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: 5000,
                duration: "120s",
                polyline: { encodedPolyline: "_sywC_nqdVo}@o}@" },
                legs: [
                  {
                    steps: [
                      {
                        distanceMeters: 5000,
                        staticDuration: "120s",
                        navigationInstruction: { instructions: "直走" },
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const result = await provider.calculate({ request, profile: "car", blockedSignals: [] });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.paths[0]?.provider).toBe("google");
      expect(result.paths[0]?.coordinates[0]).toEqual({ latitude: 25.04, longitude: 121.5 });
      expect(result.paths[0]?.durationSeconds).toBe(120);
    }
    expect(JSON.parse(body)).toMatchObject({
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes: true,
    });
  });

  it("returns a typed unavailable result for quota errors", async () => {
    const provider = new GoogleRoutesProvider({
      apiKey: "test-key",
      fetchImpl: async () => new Response("", { status: 429 }),
    });

    const result = await provider.calculate({ request, profile: "car", blockedSignals: [] });

    expect(result).toEqual({
      status: "unavailable",
      reason: "Google Routes API 配額已達上限，請稍後再試",
    });
  });

  it("maps public transit to Google's transit mode", async () => {
    let body = "";
    const provider = new GoogleRoutesProvider({
      apiKey: "test-key",
      fetchImpl: async (_input, init) => {
        body = String(init?.body);
        return new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: 5000,
                duration: "120s",
                polyline: { encodedPolyline: "_sywC_nqdVo}@o}@" },
                legs: [],
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const result = await provider.calculate({
      request: {
        ...request,
        profiles: ["transit"],
        departureAt: "2026-08-18T13:00:00+08:00",
      },
      profile: "transit",
      blockedSignals: [],
    });

    expect(result.status).toBe("ok");
    expect(JSON.parse(body)).toMatchObject({
      travelMode: "TRANSIT",
      departureTime: "2026-08-18T13:00:00+08:00",
      transitPreferences: {
        allowedTravelModes: ["BUS", "SUBWAY", "TRAIN", "LIGHT_RAIL", "RAIL"],
        routingPreference: "FEWER_TRANSFERS",
      },
    });
    expect(JSON.parse(body).routingPreference).toBeUndefined();
  });

  it("accepts transit steps without text navigation instructions", async () => {
    const provider = new GoogleRoutesProvider({
      apiKey: "test-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: 5000,
                duration: "120s",
                polyline: { encodedPolyline: "_sywC_nqdVo}@o}@" },
                legs: [
                  {
                    steps: [
                      {
                        distanceMeters: 500,
                        staticDuration: "30s",
                        navigationInstruction: {},
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    });

    const result = await provider.calculate({
      request: { ...request, profiles: ["transit"] },
      profile: "transit",
      blockedSignals: [],
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.paths[0]?.instructions).toEqual([]);
  });

  it("explains a 403 without exposing the API key", async () => {
    const provider = new GoogleRoutesProvider({
      apiKey: "secret-test-key",
      fetchImpl: async () =>
        new Response("PERMISSION_DENIED: Routes API is not enabled", { status: 403 }),
    });

    const result = await provider.calculate({ request, profile: "car", blockedSignals: [] });

    expect(result).toEqual({
      status: "unavailable",
      reason:
        "Google Routes 回傳 403：請確認 Routes API、billing 與 server key restriction（PERMISSION_DENIED: Routes API is not enabled）",
    });
    expect(JSON.stringify(result)).not.toContain("secret-test-key");
  });

  it("asks Google for waypoint detours when a hard area signal is present", async () => {
    const bodies: string[] = [];
    const provider = new GoogleRoutesProvider({
      apiKey: "test-key",
      fetchImpl: async (_input, init) => {
        bodies.push(String(init?.body));
        return new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: 5000,
                duration: "120s",
                polyline: { encodedPolyline: "_sywC_nqdVo}@o}@" },
                legs: [],
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const result = await provider.calculate({
      request,
      profile: "car",
      blockedSignals: [
        {
          id: "flood-1",
          kind: "flood_zone",
          label: "淹水區",
          polygon: [
            { latitude: 25.043, longitude: 121.502 },
            { latitude: 25.043, longitude: 121.508 },
            { latitude: 25.047, longitude: 121.508 },
            { latitude: 25.047, longitude: 121.502 },
            { latitude: 25.043, longitude: 121.502 },
          ],
          severity: "blocked",
          observedAt: "2026-08-17T08:00:00+08:00",
          evidenceId: "e-flood-1",
          summary: "道路積水禁止通行",
        },
      ],
    });

    expect(result.status).toBe("ok");
    expect(bodies.length).toBeGreaterThanOrEqual(7);
    expect(bodies.some((body) => JSON.parse(body).intermediates?.length === 2)).toBe(true);
    expect(bodies.some((body) => JSON.parse(body).routeModifiers?.avoidHighways)).toBe(true);
    expect(
      bodies.some((body) => {
        const modifiers = JSON.parse(body).routeModifiers;
        return modifiers?.avoidHighways && modifiers?.avoidTolls && modifiers?.avoidFerries;
      }),
    ).toBe(true);
  });

  it("asks Google for a combined detour when multiple hard areas overlap the trip", async () => {
    const bodies: string[] = [];
    const provider = new GoogleRoutesProvider({
      apiKey: "test-key",
      fetchImpl: async (_input, init) => {
        bodies.push(String(init?.body));
        return new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: 5000,
                duration: "120s",
                polyline: { encodedPolyline: "_sywC_nqdVo}@o}@" },
                legs: [],
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    await provider.calculate({
      request,
      profile: "car",
      blockedSignals: [
        {
          id: "flood-1",
          kind: "flood_zone",
          label: "淹水區一",
          polygon: [
            { latitude: 25.043, longitude: 121.502 },
            { latitude: 25.043, longitude: 121.504 },
            { latitude: 25.045, longitude: 121.504 },
            { latitude: 25.045, longitude: 121.502 },
            { latitude: 25.043, longitude: 121.502 },
          ],
          severity: "blocked",
          observedAt: "2026-08-17T08:00:00+08:00",
          evidenceId: "e-flood-1",
          summary: "道路積水禁止通行",
        },
        {
          id: "closure-1",
          kind: "road_closure",
          label: "封路區",
          polygon: [
            { latitude: 25.046, longitude: 121.506 },
            { latitude: 25.046, longitude: 121.508 },
            { latitude: 25.048, longitude: 121.508 },
            { latitude: 25.048, longitude: 121.506 },
            { latitude: 25.046, longitude: 121.506 },
          ],
          severity: "blocked",
          observedAt: "2026-08-17T08:00:00+08:00",
          evidenceId: "e-closure-1",
          summary: "道路封閉",
        },
      ],
    });

    expect(bodies.some((body) => JSON.parse(body).intermediates?.length === 2)).toBe(true);
  });
});
