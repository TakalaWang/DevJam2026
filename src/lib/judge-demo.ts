export type JudgeDemoPhase =
  | "idle"
  | "confirming"
  | "starting"
  | "navigating"
  | "incident"
  | "rerouting"
  | "completed"
  | "stopped"
  | "error";

export type JudgeDemoStep = {
  phase: Exclude<JudgeDemoPhase, "idle" | "stopped" | "error">;
  atMs: number;
  label: string;
  description: string;
};

export const JUDGE_DEMO_INCIDENT_MS = 35_000;
export const JUDGE_DEMO_TOTAL_MS = 120_000;

export const JUDGE_DEMO_TIMELINE: readonly JudgeDemoStep[] = [
  {
    phase: "confirming",
    atMs: 0,
    label: "確認行程",
    description: "Routa 正在和使用者確認今天的安排。",
  },
  {
    phase: "starting",
    atMs: 8_000,
    label: "開始導航",
    description: "行程已確認，正在啟動即時導航。",
  },
  {
    phase: "navigating",
    atMs: 15_000,
    label: "導航中",
    description: "持續監測路況與行程中的交通段落。",
  },
  {
    phase: "incident",
    atMs: JUDGE_DEMO_INCIDENT_MS,
    label: "偵測災害",
    description: "偵測到前方道路封閉，正在通知使用者。",
  },
  {
    phase: "rerouting",
    atMs: JUDGE_DEMO_INCIDENT_MS + 8_000,
    label: "重新規劃",
    description: "已避開受影響路段，正在套用新的行程安排。",
  },
  {
    phase: "completed",
    atMs: JUDGE_DEMO_TOTAL_MS,
    label: "Demo 完成",
    description: "兩分鐘評審流程完成。",
  },
] as const;

export function judgeDemoStepAt(elapsedMs: number): JudgeDemoStep {
  const safeElapsed = Math.max(0, elapsedMs);
  let current = JUDGE_DEMO_TIMELINE[0];
  for (const step of JUDGE_DEMO_TIMELINE) {
    if (step.atMs > safeElapsed) break;
    current = step;
  }
  return current;
}

export function isJudgeDemoRunning(phase: JudgeDemoPhase): boolean {
  return (
    phase === "confirming" ||
    phase === "starting" ||
    phase === "navigating" ||
    phase === "incident" ||
    phase === "rerouting"
  );
}

export function judgeDemoNextPhase(phase: JudgeDemoPhase): JudgeDemoPhase | undefined {
  switch (phase) {
    case "confirming":
      return "starting";
    case "starting":
      return "navigating";
    case "navigating":
      return "incident";
    case "incident":
      return "rerouting";
    case "rerouting":
      return "completed";
    default:
      return undefined;
  }
}
