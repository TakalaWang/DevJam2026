import type { RouteProvider, RouteResult } from "../src/planner";

const endpoint = "https://routes.googleapis.com/directions/v2:computeRoutes";
const fieldMask = "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline";

export const demoRouteProvider: RouteProvider = async (origin, destination) => {
  const times: Record<string, number> = {
    "台北車站>大稻埕": 600,
    "大稻埕>台北 101": 2_400,
    "台北車站>台北 101": 1_800,
    "台北 101>大稻埕": 900,
    "大稻埕>內湖科技園區": 3_000,
    "台北 101>內湖科技園區": 1_200,
    "內湖科技園區>大稻埕": 3_000,
  };
  const trafficSeconds = times[`${origin}>${destination}`] ?? 1_260;
  return { origin, destination, normalSeconds: Math.round(trafficSeconds * 0.82), trafficSeconds, distanceMeters: trafficSeconds > 2_000 ? 22_000 : 10_000 };
};

export function googleRouteProvider(apiKey: string): RouteProvider {
  return async (origin, destination, departureTime): Promise<RouteResult> => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": fieldMask },
      body: JSON.stringify({
        origin: { address: origin },
        destination: { address: destination },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE_OPTIMAL",
        computeAlternativeRoutes: true,
        departureTime: departureTime ?? new Date().toISOString(),
      }),
    });
    if (!response.ok) throw new Error(`Google Routes API 回傳 ${response.status}`);
    const data = await response.json() as { routes?: Array<{ duration: string; staticDuration?: string; distanceMeters: number; polyline?: { encodedPolyline?: string } }> };
    if (!data.routes?.length) throw new Error("Google Routes API 沒有找到可用路線");
    const route = data.routes.reduce((best, current) => seconds(current.duration) < seconds(best.duration) ? current : best);
    return { origin, destination, normalSeconds: seconds(route.staticDuration ?? route.duration), trafficSeconds: seconds(route.duration), distanceMeters: route.distanceMeters, encodedPolyline: route.polyline?.encodedPolyline };
  };
}

function seconds(duration: string): number {
  return Math.round(Number(duration.replace("s", "")));
}
