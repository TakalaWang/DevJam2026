import { RouteSignalSchema, type DemoScenario, type RouteSignal } from "../../contracts";

const taipeiPolygon = [
  { latitude: 25.03, longitude: 121.5 },
  { latitude: 25.03, longitude: 121.56 },
  { latitude: 25.07, longitude: 121.56 },
  { latitude: 25.07, longitude: 121.5 },
  { latitude: 25.03, longitude: 121.5 },
];

export function demoSignal(scenario: DemoScenario): RouteSignal {
  const observedAt = new Date().toISOString();
  const base = {
    id: `demo-${scenario}`,
    label: "本地 Demo 城市事件",
    observedAt,
    evidenceId: `demo-evidence-${scenario}`,
  };
  if (scenario === "flood") {
    return RouteSignalSchema.parse({
      ...base,
      kind: "flood_zone",
      label: "示範淹水區",
      summary: "目前路段積水，需重新評估可行路線。",
      severity: "blocked",
      polygon: taipeiPolygon,
    });
  }
  if (scenario === "road_closure") {
    return RouteSignalSchema.parse({
      ...base,
      kind: "road_closure",
      label: "示範道路封閉",
      summary: "前方道路暫時封閉，禁止原路段通行。",
      severity: "blocked",
      polygon: taipeiPolygon,
    });
  }
  if (scenario === "station_disruption") {
    return RouteSignalSchema.parse({
      ...base,
      kind: "station_disruption",
      label: "示範車站中斷",
      summary: "轉乘車站暫停服務，需重新安排交通工具。",
      stationId: "demo-station",
      status: "suspended",
      polygon: taipeiPolygon,
    });
  }
  return RouteSignalSchema.parse({
    ...base,
    kind: "bike_station",
    label: "示範 YouBike 無車",
    summary: "起點站目前沒有可借車輛，建議改用其他交通工具。",
    stationId: "demo-bike-station",
    coordinate: { latitude: 25.0478, longitude: 121.517 },
    availableBikes: 0,
    availableDocks: 12,
  });
}
