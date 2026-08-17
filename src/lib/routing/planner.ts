import { randomUUID } from "node:crypto";
import {
  RouteFindingSchema,
  RoutePlanSchema,
  RouteRequestSchema,
  RouteSignalSchema,
  type RouteEvaluation,
  type RouteFinding,
  type RoutePath,
  type RoutePlan,
  type RouteProviderResult,
  type RouteRequest,
  type RouteSignal,
} from "../../contracts";
import { routeIntersectsPolygon } from "./geometry";
import type { GraphHopperRouteInput } from "./graphhopper";

export interface RouteProvider {
  calculate(input: GraphHopperRouteInput): Promise<RouteProviderResult>;
}

function hardAreaFinding(path: RoutePath, signal: RouteSignal): RouteFinding | undefined {
  if (
    signal.kind === "flood_zone" &&
    signal.severity === "blocked" &&
    routeIntersectsPolygon(path.coordinates, signal.polygon)
  ) {
    return RouteFindingSchema.parse({
      code: "flooded_segment",
      severity: "error",
      signalId: signal.id,
      message: `路線 ${path.id} 穿過淹水區 ${signal.label}`,
    });
  }
  if (signal.kind === "road_closure" && routeIntersectsPolygon(path.coordinates, signal.polygon)) {
    return RouteFindingSchema.parse({
      code: "road_closed",
      severity: "error",
      signalId: signal.id,
      message: `路線 ${path.id} 穿過封路區 ${signal.label}`,
    });
  }
  if (
    signal.kind === "station_disruption" &&
    signal.status !== "delayed" &&
    (path.stationIds.includes(signal.stationId) ||
      routeIntersectsPolygon(path.coordinates, signal.polygon))
  ) {
    return RouteFindingSchema.parse({
      code: "station_disrupted",
      severity: "error",
      signalId: signal.id,
      message: `路線 ${path.id} 需要經過異常車站 ${signal.stationId}`,
    });
  }
  if (
    signal.kind === "low_lighting" &&
    signal.severity === "blocked" &&
    routeIntersectsPolygon(path.coordinates, signal.polygon)
  ) {
    return RouteFindingSchema.parse({
      code: "low_lighting",
      severity: "error",
      signalId: signal.id,
      message: `路線 ${path.id} 穿過夜間照明不足區 ${signal.label}`,
    });
  }
  return undefined;
}

function bikeFinding(
  request: RouteRequest,
  path: RoutePath,
  signal: RouteSignal,
): RouteFinding | undefined {
  if (path.profile !== "bike" || signal.kind !== "bike_station") return undefined;
  const requirement = request.bikeStations.find(
    (station) => station.stationId === signal.stationId,
  );
  if (!requirement) return undefined;
  if (requirement.role === "origin_pickup" && signal.availableBikes === 0) {
    return RouteFindingSchema.parse({
      code: "bike_unavailable",
      severity: "error",
      signalId: signal.id,
      message: `YouBike 起點站 ${signal.stationId} 目前無可借車輛`,
    });
  }
  if (requirement.role === "destination_dropoff" && signal.availableDocks === 0) {
    return RouteFindingSchema.parse({
      code: "bike_dock_unavailable",
      severity: "error",
      signalId: signal.id,
      message: `YouBike 目的地站 ${signal.stationId} 目前無可還車位`,
    });
  }
  return undefined;
}

function evaluate(request: RouteRequest, path: RoutePath, signals: RouteSignal[]): RouteEvaluation {
  let score = path.durationSeconds;
  const findings: RouteFinding[] = [];
  for (const signal of signals) {
    const hardFinding = hardAreaFinding(path, signal) ?? bikeFinding(request, path, signal);
    if (hardFinding) {
      findings.push(hardFinding);
      continue;
    }
    if (signal.kind === "traffic" && routeIntersectsPolygon(path.coordinates, signal.polygon)) {
      findings.push(
        RouteFindingSchema.parse({
          code: "traffic_delay",
          severity: "warning",
          signalId: signal.id,
          message: `路線 ${path.id} 位於${signal.label}，增加約 ${signal.delaySeconds} 秒`,
        }),
      );
      score += signal.delaySeconds;
    }
    if (
      signal.kind === "flood_zone" &&
      signal.severity === "warning" &&
      routeIntersectsPolygon(path.coordinates, signal.polygon)
    ) {
      findings.push(
        RouteFindingSchema.parse({
          code: "flooded_segment",
          severity: "warning",
          signalId: signal.id,
          message: `路線 ${path.id} 接近警戒淹水區 ${signal.label}`,
        }),
      );
      score += 300;
    }
    if (
      signal.kind === "station_disruption" &&
      signal.status === "delayed" &&
      (path.stationIds.includes(signal.stationId) ||
        routeIntersectsPolygon(path.coordinates, signal.polygon))
    ) {
      findings.push(
        RouteFindingSchema.parse({
          code: "station_disrupted",
          severity: "warning",
          signalId: signal.id,
          message: `路線 ${path.id} 經過延誤車站 ${signal.stationId}`,
        }),
      );
      score += 600;
    }
    if (
      signal.kind === "low_lighting" &&
      signal.severity === "warning" &&
      routeIntersectsPolygon(path.coordinates, signal.polygon)
    ) {
      findings.push(
        RouteFindingSchema.parse({
          code: "low_lighting",
          severity: "warning",
          signalId: signal.id,
          message: `路線 ${path.id} 經過照明不足區 ${signal.label}`,
        }),
      );
      score += 300;
    }
  }
  return {
    path,
    allowed: !findings.some((finding) => finding.severity === "error"),
    score,
    findings,
  };
}

function uniquePaths(paths: RoutePath[]): RoutePath[] {
  return paths.filter(
    (path, index, all) => all.findIndex((candidate) => candidate.id === path.id) === index,
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export class RoutePlanner {
  constructor(private readonly provider: RouteProvider) {}

  async plan(rawRequest: RouteRequest, rawSignals: RouteSignal[]): Promise<RoutePlan> {
    const request = RouteRequestSchema.parse(rawRequest);
    const signals = rawSignals.map((signal) => RouteSignalSchema.parse(signal));
    const baselineResults = await Promise.all(
      request.profiles.map((profile) =>
        this.provider.calculate({ request, profile, blockedSignals: [] }),
      ),
    );
    const baselinePaths = uniquePaths(
      baselineResults.filter((result) => result.status === "ok").flatMap((result) => result.paths),
    );
    if (!baselinePaths.length)
      return this.unavailable(request, signals, "GraphHopper 沒有回傳基準路線");

    const candidateResults = signals.length
      ? await Promise.all(
          request.profiles.map((profile) =>
            this.provider.calculate({ request, profile, blockedSignals: signals }),
          ),
        )
      : baselineResults;
    const candidatePaths = uniquePaths(
      candidateResults.filter((result) => result.status === "ok").flatMap((result) => result.paths),
    );
    if (!candidatePaths.length)
      return this.unavailable(request, signals, "GraphHopper 沒有回傳候選路線");

    const evaluations = uniquePaths([...candidatePaths, ...baselinePaths]).map((path) =>
      evaluate(request, path, signals),
    );
    const baseline = [...evaluations]
      .filter((evaluation) => baselinePaths.some((path) => path.id === evaluation.path.id))
      .sort((left, right) => left.path.durationSeconds - right.path.durationSeconds)[0]?.path;
    const allowed = evaluations
      .filter((evaluation) => evaluation.allowed)
      .sort(
        (left, right) =>
          left.score - right.score || left.path.durationSeconds - right.path.durationSeconds,
      );
    const evidenceIds = uniqueStrings(signals.map((signal) => signal.evidenceId));
    if (!allowed.length) {
      return RoutePlanSchema.parse({
        id: `plan-${randomUUID()}`,
        status: "no_safe_route",
        request,
        baseline,
        evaluations,
        signals,
        generatedAt: new Date().toISOString(),
        evidenceIds,
        reason: "所有候選路線都受到目前城市事件阻擋",
      });
    }

    const baselineEvaluation = baseline
      ? evaluations.find((evaluation) => evaluation.path.id === baseline.id)
      : undefined;
    const boundedAllowed = baselineEvaluation?.allowed
      ? allowed.filter(
          (evaluation) =>
            evaluation.path.id === baseline.id ||
            evaluation.score <= baseline.durationSeconds + request.maxExtraMinutes * 60,
        )
      : allowed;
    const selected = boundedAllowed[0] ?? allowed[0];
    if (!selected) return this.unavailable(request, signals, "沒有可選擇的候選路線");
    const alternatives = allowed.slice(1).map((evaluation) => evaluation.path);
    const baselineFindings = baseline ? evaluate(request, baseline, signals).findings : [];
    const reason =
      baseline && baseline.id !== selected.path.id
        ? `已從 ${baseline.id} 改道；原因：${baselineFindings.map((finding) => finding.message).join("、") || "候選路線評分較低"}`
        : "目前路線通過城市狀態檢查";
    return RoutePlanSchema.parse({
      id: `plan-${randomUUID()}`,
      status: "ok",
      request,
      baseline: baseline ?? selected.path,
      selected: selected.path,
      alternatives,
      evaluations,
      signals,
      generatedAt: new Date().toISOString(),
      evidenceIds,
      rerouted: baseline ? baseline.id !== selected.path.id : false,
      reason,
    });
  }

  private unavailable(request: RouteRequest, signals: RouteSignal[], reason: string): RoutePlan {
    return RoutePlanSchema.parse({
      id: `plan-${randomUUID()}`,
      status: "unavailable",
      request,
      evaluations: [],
      signals,
      generatedAt: new Date().toISOString(),
      evidenceIds: uniqueStrings(signals.map((signal) => signal.evidenceId)),
      reason,
    });
  }
}
