import {
  ValidatorResultSchema,
  type DayPlan,
  type ScheduleItem,
  type ValidatorResult,
} from "../../contracts";

function timestamp(value: string): number {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : Number.NaN;
}

export function validateSchedule(day: DayPlan, proposed?: ScheduleItem): ValidatorResult {
  const schedule = proposed ? [...day.schedule, proposed] : day.schedule;
  const findings = [];

  for (const item of schedule) {
    const start = timestamp(item.start);
    const end = timestamp(item.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      findings.push({
        severity: "error" as const,
        code: "invalid_time" as const,
        targetId: item.id,
        message: `${item.id} 的開始或結束時間無效`,
        suggestedChange: "重新提供有效的開始與結束時間",
      });
    }
  }

  const sorted = [...schedule].sort(
    (left, right) => timestamp(left.start) - timestamp(right.start),
  );

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (timestamp(previous.end) > timestamp(current.start)) {
      findings.push({
        severity: "error" as const,
        code: "time_conflict" as const,
        targetId: current.id,
        message: `${previous.id} 與 ${current.id} 時間重疊`,
        suggestedChange: "移動目前活動或縮短前一個活動",
      });
    }
  }

  if (proposed && !proposed.routeEvidenceId) {
    findings.push({
      severity: "warning" as const,
      code: "unverified" as const,
      targetId: proposed.id,
      message: "這個活動缺少交通證據，不能直接視為已驗證",
      suggestedChange: "重新查詢 Routes API 或要求使用者確認",
    });
  }

  return ValidatorResultSchema.parse({
    valid: findings.every((finding) => finding.severity !== "error"),
    findings,
  });
}

export function validateCrossDay(days: DayPlan[]): ValidatorResult {
  const findings = [];
  for (let index = 1; index < days.length; index += 1) {
    if (days[index - 1].date >= days[index].date) {
      findings.push({
        severity: "error" as const,
        code: "time_conflict" as const,
        targetId: days[index].date,
        message: "每日行程日期順序不正確",
        suggestedChange: "重新排序每日行程",
      });
    }
  }
  return ValidatorResultSchema.parse({ valid: findings.length === 0, findings });
}
