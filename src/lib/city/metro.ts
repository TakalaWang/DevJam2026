import {
  CityObservationSchema,
  RouteSignalSchema,
  type CityFeedResult,
  type CityName,
  type CityObservation,
} from "../../contracts";
import {
  circlePolygon,
  evidenceId,
  isoTimestamp,
  makeFeedResult,
  now,
  observationId,
  signalExpiry,
} from "./common";
import { z } from "zod";

const MetroCrowdRecordSchema = z.object({
  StationID: z.string().optional(),
  StationName: z.string().optional(),
  Position: z
    .object({
      PositionLat: z.coerce.number().min(-90).max(90),
      PositionLon: z.coerce.number().min(-180).max(180),
    })
    .optional(),
  Latitude: z.coerce.number().min(-90).max(90).optional(),
  Longitude: z.coerce.number().min(-180).max(180).optional(),
  CrowdLevel: z.string().optional(),
  CrowdingLevel: z.string().optional(),
  LoadLevel: z.string().optional(),
  UpdateTime: z.string().optional(),
});
const MetroCrowdCollectionSchema = z.union([
  z.array(MetroCrowdRecordSchema),
  z.object({ value: z.array(MetroCrowdRecordSchema) }),
  z.object({ data: z.array(MetroCrowdRecordSchema) }),
]);

type TaipeiMetroClientOptions = {
  apiKey?: string;
  url?: string;
  fetchImpl?: typeof fetch;
};

function crowdLevel(value: string | undefined): "normal" | "high" | "critical" {
  if (!value) return "normal";
  if (/滿|極高|critical|3|4/.test(value.toLowerCase())) return "critical";
  if (/高|high|2/.test(value.toLowerCase())) return "high";
  return "normal";
}

function coordinate(record: z.infer<typeof MetroCrowdRecordSchema>) {
  if (record.Position) {
    return { latitude: record.Position.PositionLat, longitude: record.Position.PositionLon };
  }
  if (record.Latitude !== undefined && record.Longitude !== undefined) {
    return { latitude: record.Latitude, longitude: record.Longitude };
  }
  return undefined;
}

export class TaipeiMetroClient {
  private readonly apiKey: string | undefined;
  private readonly url: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TaipeiMetroClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.TAIPEI_METRO_API_KEY;
    this.url = options.url ?? process.env.TAIPEI_METRO_CROWDING_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchCity(city: CityName): Promise<CityFeedResult> {
    const fetchedAt = now();
    if (city !== "Taipei") {
      return makeFeedResult(
        "taipei_metro",
        "unavailable",
        fetchedAt,
        [],
        [],
        "目前僅接臺北捷運資料",
      );
    }
    if (!this.apiKey || !this.url) {
      return makeFeedResult(
        "taipei_metro",
        "unavailable",
        fetchedAt,
        [],
        [],
        "TAIPEI_METRO_API_KEY／TAIPEI_METRO_CROWDING_URL 未設定；捷運擁擠 API 需申請會員",
      );
    }
    try {
      const response = await this.fetchImpl(this.url, {
        headers: { authorization: `Bearer ${this.apiKey}`, "x-api-key": this.apiKey },
      });
      if (!response.ok) throw new Error(`臺北捷運擁擠 API 回傳 ${response.status}`);
      const data = MetroCrowdCollectionSchema.parse(await response.json());
      const records = Array.isArray(data) ? data : "value" in data ? data.value : data.data;
      const observations: CityObservation[] = [];
      const signals = [];
      for (const record of records) {
        const stationId = record.StationID;
        const point = coordinate(record);
        if (!stationId || !point) continue;
        const level = crowdLevel(record.CrowdLevel ?? record.CrowdingLevel ?? record.LoadLevel);
        const id = observationId("taipei_metro", `crowd-${stationId}`);
        const summary = `${record.StationName ?? stationId} 捷運擁擠程度：${level}`;
        observations.push(
          CityObservationSchema.parse({
            id,
            source: "taipei_metro",
            kind: "metro_crowding",
            stationId,
            coordinate: point,
            crowdLevel: level,
            observedAt: isoTimestamp(record.UpdateTime, fetchedAt),
            fetchedAt,
            evidenceId: evidenceId("taipei_metro", id),
            summary,
          }),
        );
        if (level !== "normal") {
          const polygon = circlePolygon(point, 0.0015);
          signals.push(
            RouteSignalSchema.parse({
              id,
              kind: "metro_crowding",
              stationId,
              polygon,
              crowdLevel: level,
              severity: level === "critical" ? "critical" : "warning",
              label: record.StationName ?? `捷運站 ${stationId}`,
              observedAt: isoTimestamp(record.UpdateTime, fetchedAt),
              expiresAt: signalExpiry(fetchedAt),
              evidenceId: evidenceId("taipei_metro", id),
              summary,
            }),
          );
        }
      }
      return makeFeedResult("taipei_metro", "fresh", fetchedAt, observations, signals);
    } catch (error) {
      return makeFeedResult(
        "taipei_metro",
        "unavailable",
        fetchedAt,
        [],
        [],
        error instanceof Error ? error.message : "臺北捷運擁擠資料無法取得",
      );
    }
  }
}
