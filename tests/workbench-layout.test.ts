import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

describe("workbench independent scrolling layout", () => {
  it("keeps the desktop shell fixed while each region owns its scroll container", () => {
    expect(stylesheet).toMatch(/\.workbench\s*\{[\s\S]*?height:\s*100vh;[\s\S]*?overflow:\s*hidden;/);
    expect(stylesheet).toMatch(/\.workbench-grid\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/);
    expect(stylesheet).toMatch(
      /\.history-sidebar,\s*\.itinerary-panel\s*\{[\s\S]*?overflow-y:\s*auto;/,
    );
    expect(stylesheet).toMatch(/\.conversation-panel\s*\{[\s\S]*?overflow:\s*hidden;/);
    expect(stylesheet).toMatch(/\.conversation-log\s*\{[\s\S]*?overflow-y:\s*auto;/);
    expect(stylesheet).toMatch(/\.composer\s*\{[\s\S]*?flex:\s*0 0 auto;/);
  });
});
