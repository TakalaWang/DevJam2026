import { describe, expect, it } from "vitest";
import { optimizeItinerary, type ItineraryIntent, type RouteProvider } from "../src/planner";

const intent: ItineraryIntent = {
  date: "2026-08-17",
  start: { name: "台北車站", time: "13:00" },
  stops: [
    { name: "台北 101", time: "14:00", flexible: false },
    { name: "大稻埕", flexible: true },
    { name: "內湖科技園區", time: "18:30", flexible: false },
  ],
  preference: "開車避開塞車",
};

const routes: Record<string, number> = {
  "台北車站>大稻埕": 600,
  "大稻埕>台北 101": 2_400,
  "台北車站>台北 101": 1_800,
  "台北 101>大稻埕": 900,
  "大稻埕>內湖科技園區": 3_000,
  "台北 101>內湖科技園區": 1_200,
  "內湖科技園區>大稻埕": 3_000,
};

const provider: RouteProvider = async (origin, destination) => ({
  origin, destination, normalSeconds: routes[`${origin}>${destination}`] ?? 900,
  trafficSeconds: routes[`${origin}>${destination}`] ?? 900, distanceMeters: 1000,
});

describe("optimizeItinerary", () => {
  it("keeps fixed appointments in time order and inserts flexible stops", async () => {
    const result = await optimizeItinerary(intent, provider);
    expect(result.stops.map((stop) => stop.name)).toEqual(["台北車站", "大稻埕", "台北 101", "內湖科技園區"]);
    expect(result.stops.find((stop) => stop.name === "台北 101")?.fixed).toBe(true);
    expect(result.reason).toContain("重新安排");
  });
});
