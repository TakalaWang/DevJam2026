import { describe, expect, it } from "vitest";
import { itineraryStops, routeSummary } from "../src/lib/itinerary";

describe("Routecraft itinerary presentation data", () => {
  it("keeps fixed appointments and flexible stops explicit", () => {
    expect(itineraryStops).toEqual([
      { time: "14:00", title: "台北 101", detail: "會議", kind: "fixed" },
      { time: "15:20", title: "大稻埕", detail: "買茶", kind: "flexible" },
      { time: "18:30", title: "內湖科技園區", detail: "晚餐", kind: "fixed" },
    ]);
  });

  it("describes the route state shown on the map", () => {
    expect(routeSummary).toEqual({
      title: "台北・一日順路版",
      stops: 3,
      fixedStops: 2,
      status: "路況最佳化中",
      source: "Gemini + Google Routes",
    });
  });
});
