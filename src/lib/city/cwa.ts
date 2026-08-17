import {
  CityObservationSchema,
  type CityFeedResult,
  type CityName,
  type CityObservation,
  RouteSignalSchema,
} from "../../contracts";
import {
  cityLabel,
  cityPolygon,
  evidenceId,
  isoTimestamp,
  makeFeedResult,
  now,
  observationId,
  signalExpiry,
} from "./common";
import { z } from "zod";

const CwaHazardInfoSchema = z.object({
  phenomena: z.string().optional(),
  significance: z.string().optional(),
  effective: z.string().optional(),
  expires: z.string().optional(),
});

const CwaHazardSchema = z.object({ info: CwaHazardInfoSchema.optional() });
const CwaLocationSchema = z.object({
  locationName: z.string().optional(),
  hazardConditions: z.object({ hazards: z.array(CwaHazardSchema).optional() }).optional(),
});
const CwaResponseSchema = z.object({
  records: z
    .object({
      location: z.array(CwaLocationSchema).optional(),
      locations: z.array(CwaLocationSchema).optional(),
    })
    .optional(),
});

type CwaClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

function warningKind(
  text: string,
): "heavy_rain" | "typhoon" | "strong_wind" | "heat" | "earthquake" {
  if (/颱風|熱帶氣旋/.test(text)) return "typhoon";
  if (/強風|陸上強風/.test(text)) return "strong_wind";
  if (/高溫|熱傷害/.test(text)) return "heat";
  if (/地震/.test(text)) return "earthquake";
  return "heavy_rain";
}

function severity(text: string): "advisory" | "warning" | "severe" | "critical" {
  if (/警報|嚴重|強烈/.test(text)) return "severe";
  if (/特報|注意/.test(text)) return "warning";
  return "advisory";
}

export class CwaClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CwaClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.CWA_API_KEY;
    this.baseUrl = options.baseUrl ?? "https://opendata.cwa.gov.tw/api/v1/rest/datastore";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchCity(city: CityName): Promise<CityFeedResult> {
    const fetchedAt = now();
    if (!this.apiKey) {
      return makeFeedResult("cwa", "unavailable", fetchedAt, [], [], "CWA_API_KEY 未設定");
    }
    try {
      const url = new URL(`${this.baseUrl}/W-C0033-001`);
      url.searchParams.set("Authorization", this.apiKey);
      url.searchParams.set("format", "JSON");
      const response = await this.fetchImpl(url);
      if (!response.ok) throw new Error(`CWA 回傳 ${response.status}`);
      const data = CwaResponseSchema.parse(await response.json());
      const locations = data.records?.location ?? data.records?.locations ?? [];
      const target = cityLabel(city);
      const observations: CityObservation[] = [];
      const signals = [];
      for (const location of locations) {
        if (location.locationName !== target) continue;
        for (const hazard of location.hazardConditions?.hazards ?? []) {
          const text = `${hazard.info?.phenomena ?? ""} ${hazard.info?.significance ?? ""}`.trim();
          if (!text) continue;
          const id = observationId("cwa", `${city}-${warningKind(text)}-${fetchedAt}`);
          const kind = warningKind(text);
          const level = severity(text);
          const polygon = cityPolygon(city);
          const summary = `${target} ${text}`;
          observations.push(
            CityObservationSchema.parse({
              id,
              source: "cwa",
              kind: "weather_warning",
              warningKind: kind,
              severity: level,
              polygon,
              observedAt: isoTimestamp(hazard.info?.effective, fetchedAt),
              fetchedAt,
              evidenceId: evidenceId("cwa", id),
              summary,
            }),
          );
          signals.push(
            RouteSignalSchema.parse({
              id,
              kind: "weather_warning",
              warningKind: kind,
              severity: level,
              polygon,
              label: `${target} 天氣警特報`,
              observedAt: isoTimestamp(hazard.info?.effective, fetchedAt),
              expiresAt: signalExpiry(fetchedAt),
              evidenceId: evidenceId("cwa", id),
              summary,
            }),
          );
        }
      }
      return makeFeedResult("cwa", "fresh", fetchedAt, observations, signals);
    } catch (error) {
      return makeFeedResult(
        "cwa",
        "unavailable",
        fetchedAt,
        [],
        [],
        error instanceof Error ? error.message : "CWA 資料無法取得",
      );
    }
  }
}
