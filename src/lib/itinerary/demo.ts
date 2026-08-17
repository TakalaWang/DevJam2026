import {
  RouteSignalSchema,
  type DemoScenario,
  type RoutePath,
  type RouteSignal,
  type RiskPolygon,
} from "../../contracts";

const demoEventPolygon = [
  { latitude: 25.045, longitude: 121.525 },
  { latitude: 25.045, longitude: 121.54 },
  { latitude: 25.065, longitude: 121.54 },
  { latitude: 25.065, longitude: 121.525 },
  { latitude: 25.045, longitude: 121.525 },
];

function eventPolygon(route?: RoutePath): RiskPolygon {
  if (!route) return demoEventPolygon;
  const segmentIndex = Math.floor((route.coordinates.length - 2) / 2);
  const start = route.coordinates[segmentIndex];
  const end = route.coordinates[segmentIndex + 1];
  if (!start || !end) return demoEventPolygon;
  const center = {
    latitude: (start.latitude + end.latitude) / 2,
    longitude: (start.longitude + end.longitude) / 2,
  };
  const halfSize = Math.min(
    0.0001,
    Math.max(
      0.000001,
      Math.max(Math.abs(end.latitude - start.latitude), Math.abs(end.longitude - start.longitude)) /
        4,
    ),
  );
  return [
    { latitude: center.latitude - halfSize, longitude: center.longitude - halfSize },
    { latitude: center.latitude - halfSize, longitude: center.longitude + halfSize },
    { latitude: center.latitude + halfSize, longitude: center.longitude + halfSize },
    { latitude: center.latitude + halfSize, longitude: center.longitude - halfSize },
    { latitude: center.latitude - halfSize, longitude: center.longitude - halfSize },
  ];
}

export function demoSignal(scenario: DemoScenario, route?: RoutePath): RouteSignal {
  const observedAt = new Date().toISOString();
  const polygon = eventPolygon(route);
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
      polygon,
    });
  }
  if (scenario === "road_closure") {
    return RouteSignalSchema.parse({
      ...base,
      kind: "road_closure",
      label: "示範道路封閉",
      summary: "前方道路暫時封閉，禁止原路段通行。",
      severity: "blocked",
      polygon,
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
      polygon,
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
