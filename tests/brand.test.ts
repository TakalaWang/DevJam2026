import { describe, expect, it } from "vitest";
import { routaAssistantLabel, routaBrand, routaSubtitle } from "../src/lib/brand";

describe("Routa branding", () => {
  it("keeps the product identity consistent across the workbench", () => {
    expect(routaBrand).toBe("ROUTA 智旅");
    expect(routaSubtitle).toBe("SMART TRAVEL PLANNER");
    expect(routaAssistantLabel).toBe("ROUTA");
  });
});
