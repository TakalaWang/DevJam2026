import type { ItineraryIntent, StopIntent } from "./intent";
export type { ItineraryIntent } from "./intent";

export type RouteResult = {
  origin: string;
  destination: string;
  normalSeconds: number;
  trafficSeconds: number;
  distanceMeters: number;
  encodedPolyline?: string;
};

export type RouteProvider = (origin: string, destination: string, departureTime?: string) => Promise<RouteResult>;
export type PlannedStop = StopIntent & { fixed: boolean; arrivalTime: string; leaveBy?: string };
export type OptimizedItinerary = { stops: PlannedStop[]; routes: RouteResult[]; reason: string; totalSeconds: number };

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

export async function optimizeItinerary(intent: ItineraryIntent, provider: RouteProvider): Promise<OptimizedItinerary> {
  const fixed = intent.stops.filter((stop) => !stop.flexible).sort((a, b) => toMinutes(a.time ?? "23:59") - toMinutes(b.time ?? "23:59"));
  const flexible = intent.stops.filter((stop) => stop.flexible);
  const candidates = permutations(intent.stops).filter((candidate) => candidate.filter((stop) => !stop.flexible).map((stop) => stop.name).join("|") === fixed.map((stop) => stop.name).join("|"));
  const cache = new Map<string, RouteResult>();
  const routeFor = async (origin: string, destination: string, departureMinutes: number) => {
    const key = `${origin}>${destination}@${toTime(departureMinutes)}`;
    if (!cache.has(key)) cache.set(key, await provider(origin, destination, `${intent.date}T${toTime(departureMinutes)}:00+08:00`));
    return cache.get(key)!;
  };

  let best: { candidate: StopIntent[]; routes: RouteResult[]; arrivals: number[]; total: number } | undefined;
  for (const candidate of candidates) {
    let current = toMinutes(intent.start.time);
    const routes: RouteResult[] = [];
    const arrivals: number[] = [];
    let valid = true;
    let total = 0;
    let origin = intent.start.name;
    for (const stop of candidate) {
      const route = await routeFor(origin, stop.name, current);
      routes.push(route);
      current += Math.ceil(route.trafficSeconds / 60);
      total += route.trafficSeconds;
      if (stop.time) {
        const target = toMinutes(stop.time);
        if (current > target) { valid = false; break; }
        current = target;
      }
      arrivals.push(current);
      origin = stop.name;
    }
    if (valid && (!best || total < best.total)) best = { candidate, routes, arrivals, total };
  }
  if (!best) throw new Error("目前的固定時間與交通時間無法排出可行行程");
  const stops: PlannedStop[] = [{ ...intent.start, fixed: true, flexible: false, arrivalTime: intent.start.time }, ...best.candidate.map((stop, index) => ({ ...stop, fixed: !stop.flexible, arrivalTime: toTime(best!.arrivals[index]), leaveBy: toTime(best!.arrivals[index] - Math.ceil(best!.routes[index].trafficSeconds / 60)) }))];
  const originalOrder = intent.stops.map((stop) => stop.name).join("|");
  const plannedOrder = best.candidate.map((stop) => stop.name).join("|");
  const reordered = originalOrder !== plannedOrder;
  return { stops, routes: best.routes, totalSeconds: best.total, reason: reordered ? "已保留固定時間，並依交通時間重新安排彈性景點。" : "固定行程順序可行，彈性景點維持原安排。" };
}
