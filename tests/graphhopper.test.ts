import { describe, expect, it } from "vitest";
import {
  GraphHopperCustomModelSchema,
  GraphHopperRouteProvider,
  createBlockedAreaCustomModel,
} from "../src/lib/routing/graphhopper";
import { routeIntersectsPolygon } from "../src/lib/routing/geometry";

const square = [
  { latitude: 25, longitude: 121 },
  { latitude: 25, longitude: 122 },
  { latitude: 24, longitude: 122 },
  { latitude: 24, longitude: 121 },
  { latitude: 25, longitude: 121 },
];

describe("GraphHopper route provider", () => {
  it("detects a route crossing a blocked polygon", () => {
    expect(
      routeIntersectsPolygon(
        [
          { latitude: 25.5, longitude: 120.5 },
          { latitude: 24.5, longitude: 121.5 },
        ],
        square,
      ),
    ).toBe(true);
  });

  it("creates a typed custom model for blocked city areas", () => {
    const model = createBlockedAreaCustomModel([
      {
        id: "flood-1",
        kind: "flood_zone",
        label: "flood",
        polygon: square,
        severity: "blocked",
        observedAt: "2026-08-17T08:00:00+08:00",
        evidenceId: "e-1",
        summary: "blocked",
      },
    ]);
    expect(GraphHopperCustomModelSchema.parse(model).priority[0]?.if).toContain("flood_1");
  });

  it("maps GraphHopper GeoJSON paths and sends route parameters", async () => {
    let requestedUrl = "";
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          paths: [
            {
              distance: 1200,
              time: 90_000,
              points: {
                type: "LineString",
                coordinates: [
                  [121.5, 25.04],
                  [121.51, 25.05],
                ],
              },
              instructions: [{ text: "直走", distance: 1200, time: 90_000 }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const provider = new GraphHopperRouteProvider({
      baseUrl: "https://graphhopper.test/api/1",
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await provider.calculate({
      request: {
        origin: { label: "A", coordinate: { latitude: 25.04, longitude: 121.5 } },
        destination: { label: "B", coordinate: { latitude: 25.05, longitude: 121.51 } },
        profiles: ["bike"],
        maxExtraMinutes: 20,
        bikeStations: [],
      },
      profile: "bike",
      blockedSignals: [],
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.paths[0]?.durationSeconds).toBe(90);
      expect(result.paths[0]?.coordinates[0]).toEqual({ latitude: 25.04, longitude: 121.5 });
    }
    const url = new URL(requestedUrl);
    expect(url.searchParams.get("profile")).toBe("bike");
    expect(url.searchParams.get("points_encoded")).toBe("false");
    expect(url.searchParams.get("key")).toBe("test-key");
  });
});
