import { describe, expect, it } from "vitest";
import { formatItineraryTime } from "../src/lib/time";

describe("itinerary time formatting", () => {
  it("formats the planned departure timestamp for the timeline", () => {
    expect(formatItineraryTime("2026-08-18T08:30:00+08:00")).toBe("08:30");
  });

  it("shows a discussion placeholder when no time is available", () => {
    expect(formatItineraryTime(undefined)).toBe("待討論");
  });
});
