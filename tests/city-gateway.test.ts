import { describe, expect, it } from "vitest";
import { CwaClient } from "../src/lib/city/cwa";
import { CityDataGateway } from "../src/lib/city/gateway";
import { TaipeiMetroClient } from "../src/lib/city/metro";
import { NcdrClient } from "../src/lib/city/ncdr";
import { TdxClient } from "../src/lib/city/tdx";

const point = { PositionLat: 25.04, PositionLon: 121.5 };
const json = (value: object): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("official city data gateways", () => {
  it("maps TDX traffic, road events, YouBike and transit alerts into typed data", async () => {
    const client = new TdxClient({
      baseUrl: "https://tdx.test",
      clientId: "client",
      clientSecret: "secret",
      requestIntervalMs: 0,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/token")) return json({ access_token: "token" });
        if (url.includes("Bike/Station")) {
          return json([
            {
              StationUID: "Y-1",
              StationName: { Zh_tw: "測試站" },
              StationPosition: point,
              UpdateTime: "2026-08-17T08:00:00+08:00",
            },
          ]);
        }
        if (url.includes("Bike/Availability")) {
          return json([
            {
              StationUID: "Y-1",
              AvailableRentBikes: 0,
              AvailableReturnBikes: 8,
              UpdateTime: "2026-08-17T08:00:00+08:00",
            },
          ]);
        }
        if (url.includes("Road/Traffic/Live")) {
          return json({
            LiveTraffics: [
              {
                SectionID: "road-1",
                RoadName: "測試道路",
                PositionLat: point.PositionLat,
                PositionLon: point.PositionLon,
                CongestionLevel: 4,
                DataCollectTime: "2026-08-17T08:00:00+08:00",
              },
            ],
          });
        }
        if (url.includes("RoadEvent/LiveEvent")) {
          return json({
            LiveEvents: [
              {
                EventID: "event-1",
                EventTitle: "道路封閉",
                EventSubType: 402,
                Description: "施工封路",
                Positions: "25.04,121.5",
                EffectiveTime: "2026-08-17T08:00:00+08:00",
                LastUpdateTime: "2026-08-17T08:00:00+08:00",
              },
            ],
          });
        }
        if (url.includes("Metro/Alert")) {
          return json({
            Alerts: [
              {
                AlertID: "metro-alert-1",
                Title: "捷運異動",
                Description: "列車延誤",
                Status: "delayed",
                UpdateTime: "2026-08-17T08:00:00+08:00",
              },
            ],
          });
        }
        if (url.includes("TRA/LiveTrainDelay")) {
          return json([
            {
              StationID: "1000",
              StationName: "臺北",
              TrainNo: "123",
              DelayTime: 10,
              UpdateTime: "2026-08-17T08:00:00+08:00",
            },
          ]);
        }
        return json([
          {
            AlertID: "alert-1",
            RouteName: "測試線",
            Description: "列車延誤",
            Status: "delayed",
            UpdateTime: "2026-08-17T08:00:00+08:00",
          },
        ]);
      },
    });

    const result = await client.fetchCity("Taipei");

    expect(result.status).toBe("fresh");
    expect(result.observations.map((item) => item.kind)).toContain("bike_station");
    expect(result.observations.map((item) => item.kind)).toContain("transit_alert");
    expect(result.signals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining(["bike_station", "traffic", "road_closure"]),
    );
  });

  it("maps CWA warnings into a city-level weather signal", async () => {
    const client = new CwaClient({
      apiKey: "cwa-key",
      fetchImpl: async () =>
        json({
          records: {
            location: [
              {
                locationName: "臺北市",
                hazardConditions: {
                  hazards: [{ info: { phenomena: "豪大雨特報", significance: "特報" } }],
                },
              },
            ],
          },
        }),
    });

    const result = await client.fetchCity("Taipei");

    expect(result.status).toBe("fresh");
    expect(result.signals[0]).toMatchObject({ kind: "weather_warning", warningKind: "heavy_rain" });
  });

  it("maps NCDR flood alerts with a supplied polygon into a hard signal", async () => {
    const client = new NcdrClient({
      apiKey: "ncdr-key",
      fetchImpl: async () =>
        json([
          {
            capid: "cap-1",
            alerttitle: "淹水警報",
            content: "臺北市道路積水",
            areaDesc: "臺北市",
            polygon: "25.03,121.49 25.03,121.51 25.05,121.51 25.05,121.49 25.03,121.49",
            effectivetime: "2026-08-17T08:00:00+08:00",
            expirestime: "2026-08-17T12:00:00+08:00",
          },
        ]),
    });

    const result = await client.fetchCity("Taipei");

    expect(result.status).toBe("fresh");
    expect(result.signals[0]).toMatchObject({ kind: "flood_zone", severity: "blocked" });
  });

  it("maps Taipei Metro crowding when the member API is configured", async () => {
    const client = new TaipeiMetroClient({
      apiKey: "metro-key",
      url: "https://metro.test/crowding",
      fetchImpl: async () =>
        json([
          {
            StationID: "BL12",
            StationName: "臺北車站",
            Position: point,
            CrowdingLevel: "高",
            UpdateTime: "2026-08-17T08:00:00+08:00",
          },
        ]),
    });

    const result = await client.fetchCity("Taipei");

    expect(result.status).toBe("fresh");
    expect(result.signals[0]).toMatchObject({
      kind: "metro_crowding",
      stationId: "BL12",
      crowdLevel: "high",
    });
  });

  it("reports missing credentials as unavailable instead of pretending the city is normal", async () => {
    const result = await new CityDataGateway({
      tdx: new TdxClient({ clientId: "", clientSecret: "" }),
      cwa: new CwaClient({ apiKey: "" }),
      ncdr: new NcdrClient({ apiKey: "" }),
      metro: new TaipeiMetroClient({ apiKey: "", url: "" }),
    }).refresh({ city: "Taipei" });

    expect(result.feeds).toHaveLength(4);
    expect(result.feeds.every((feed) => feed.status === "unavailable")).toBe(true);
    expect(result.signals).toHaveLength(0);
  });

  it("does not substitute another source when NCDR or metro crowding is unavailable", async () => {
    const [ncdr, metro] = await Promise.all([
      new NcdrClient({ apiKey: "" }).fetchCity("Taipei"),
      new TaipeiMetroClient({ apiKey: "", url: "" }).fetchCity("Taipei"),
    ]);

    expect(ncdr).toMatchObject({ source: "ncdr", status: "unavailable", observations: [], signals: [] });
    expect(metro).toMatchObject({
      source: "taipei_metro",
      status: "unavailable",
      observations: [],
      signals: [],
    });
  });
});
