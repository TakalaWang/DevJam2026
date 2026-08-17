import { describe, expect, it } from "vitest";
import { parseGeminiIntent, parseIntentFallback } from "../src/intent";

describe("parseIntentFallback", () => {
  it("extracts fixed times and flexible places from natural language", () => {
    const intent = parseIntentFallback("下午兩點到台北101開會，傍晚六點半去內湖吃飯，途中想去大稻埕買茶，開車但不要塞車");
    expect(intent.stops.find((stop) => stop.name === "台北 101")).toMatchObject({ time: "14:00", flexible: false });
    expect(intent.stops.find((stop) => stop.name === "內湖科技園區")).toMatchObject({ time: "18:30", flexible: false });
    expect(intent.stops.find((stop) => stop.name === "大稻埕")).toMatchObject({ flexible: true });
    expect(intent.preference).toContain("開車");
  });

  it("normalizes Gemini JSON that omits flexible flags", () => {
    const intent = parseGeminiIntent('{"date":"2026-08-17","start":{"name":"台北車站","time":"13:00"},"stops":[{"name":"大稻埕"},{"name":"台北 101","time":"14:00"}],"preference":"開車"}');
    expect(intent.stops).toEqual([
      { name: "大稻埕", flexible: true },
      { name: "台北 101", time: "14:00", flexible: false },
    ]);
  });
});
