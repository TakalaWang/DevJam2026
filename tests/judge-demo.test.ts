import { describe, expect, it } from "vitest";
import {
  JUDGE_DEMO_INCIDENT_MS,
  JUDGE_DEMO_TOTAL_MS,
  isJudgeDemoRunning,
  judgeDemoNextPhase,
  judgeDemoStepAt,
} from "../src/lib/judge-demo";

describe("judge demo timeline", () => {
  it("starts with the scripted confirmation and then begins navigation", () => {
    expect(judgeDemoStepAt(0).phase).toBe("confirming");
    expect(judgeDemoStepAt(8_000).phase).toBe("starting");
    expect(judgeDemoStepAt(15_000).phase).toBe("navigating");
  });

  it("injects the disaster update before re-routing", () => {
    expect(judgeDemoStepAt(JUDGE_DEMO_INCIDENT_MS).phase).toBe("incident");
    expect(judgeDemoStepAt(JUDGE_DEMO_INCIDENT_MS + 8_000).phase).toBe("rerouting");
  });

  it("finishes at the two minute mark and clamps out-of-range values", () => {
    expect(judgeDemoStepAt(JUDGE_DEMO_TOTAL_MS).phase).toBe("completed");
    expect(judgeDemoStepAt(JUDGE_DEMO_TOTAL_MS + 30_000).phase).toBe("completed");
    expect(judgeDemoStepAt(-1).phase).toBe("confirming");
  });

  it("identifies phases that still have scheduled work", () => {
    expect(isJudgeDemoRunning("confirming")).toBe(true);
    expect(isJudgeDemoRunning("rerouting")).toBe(true);
    expect(isJudgeDemoRunning("completed")).toBe(false);
    expect(isJudgeDemoRunning("stopped")).toBe(false);
  });

  it("advances to the next phase immediately after each completed action", () => {
    expect(judgeDemoNextPhase("confirming")).toBe("starting");
    expect(judgeDemoNextPhase("starting")).toBe("navigating");
    expect(judgeDemoNextPhase("navigating")).toBe("incident");
    expect(judgeDemoNextPhase("incident")).toBe("rerouting");
    expect(judgeDemoNextPhase("rerouting")).toBe("completed");
    expect(judgeDemoNextPhase("completed")).toBeUndefined();
  });
});
