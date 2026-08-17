import { describe, expect, it } from "vitest";
import { todayInTaipei } from "../src/lib/date";

describe("Taipei date", () => {
  it("uses Taiwan local date across UTC midnight", () => {
    expect(todayInTaipei(new Date("2026-08-17T16:30:00.000Z"))).toBe("2026-08-18");
  });
});
