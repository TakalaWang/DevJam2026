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
});
