import {
  CityFeedResultSchema,
  CityFeedSourceSchema,
  CityNameSchema,
  type CityFeedSource,
  type CityName,
  type CityObservation,
  type CityFeedResult,
} from "../../contracts";
import type { Coordinate, RiskPolygon, RouteSignal } from "../../contracts";

function addMinutes(timestamp: string, minutes: number): string {
  return new Date(Date.parse(timestamp) + minutes * 60_000).toISOString();
}

export function now(): string {
  return new Date().toISOString();
}

export function signalExpiry(timestamp: string): string {
  return addMinutes(timestamp, 5);
}

export function isoTimestamp(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

export function cityLabel(city: CityName): string {
  return city === "Taipei" ? "臺北市" : "新北市";
}

export function cityPolygon(city: CityName): RiskPolygon {
  return city === "Taipei"
    ? [
        { latitude: 24.96, longitude: 121.43 },
        { latitude: 24.96, longitude: 121.68 },
        { latitude: 25.22, longitude: 121.68 },
        { latitude: 25.22, longitude: 121.43 },
        { latitude: 24.96, longitude: 121.43 },
      ]
    : [
        { latitude: 24.65, longitude: 121.25 },
        { latitude: 24.65, longitude: 121.95 },
        { latitude: 25.3, longitude: 121.95 },
        { latitude: 25.3, longitude: 121.25 },
        { latitude: 24.65, longitude: 121.25 },
      ];
}

export function circlePolygon(center: Coordinate, radiusDegrees = 0.001): RiskPolygon {
  const diagonal = radiusDegrees * 0.707;
  return [
    { latitude: center.latitude - diagonal, longitude: center.longitude - diagonal },
    { latitude: center.latitude - diagonal, longitude: center.longitude + diagonal },
    { latitude: center.latitude + diagonal, longitude: center.longitude + diagonal },
    { latitude: center.latitude + diagonal, longitude: center.longitude - diagonal },
    { latitude: center.latitude - diagonal, longitude: center.longitude - diagonal },
  ];
}

export function observationId(source: CityFeedSource, id: string): string {
  return `${source}-${id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function evidenceId(source: CityFeedSource, id: string): string {
  return `evidence-${observationId(source, id)}`;
}

export function makeFeedResult(
  source: CityFeedSource,
  status: "fresh" | "stale" | "unavailable",
  fetchedAt: string,
  observations: CityObservation[],
  signals: RouteSignal[],
  message?: string,
): CityFeedResult {
  return CityFeedResultSchema.parse({
    source: CityFeedSourceSchema.parse(source),
    status,
    fetchedAt,
    observations,
    signals,
    ...(message ? { message } : {}),
  });
}

export function parseCity(value: string | undefined): CityName {
  return CityNameSchema.parse(value ?? "Taipei");
}
