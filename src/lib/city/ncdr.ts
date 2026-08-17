import {
  CityObservationSchema,
  RouteSignalSchema,
  type CityFeedResult,
  type CityName,
  type CityObservation,
} from "../../contracts";
import {
  cityLabel,
  evidenceId,
  isoTimestamp,
  makeFeedResult,
  now,
  observationId,
  signalExpiry,
} from "./common";
import { z } from "zod";

const NcdRecordSchema = z.object({
  capid: z.string().optional(),
  capcode: z.string().optional(),
  alerttitle: z.string().optional(),
  content: z.string().optional(),
  areaDesc: z.string().optional(),
  effectivetime: z.string().optional(),
  expirestime: z.string().optional(),
  polygon: z.string().optional(),
});
const NcdCollectionSchema = z.union([
  z.array(NcdRecordSchema),
  z.object({
    data: z.array(NcdRecordSchema).optional(),
    records: z.array(NcdRecordSchema).optional(),
    result: z.array(NcdRecordSchema).optional(),
  }),
]);

type NcdrClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

function parsePolygon(value: string | undefined) {
  if (!value) return undefined;
  const points = value
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number))
    .filter((pair): pair is [number, number] => pair.length === 2 && pair.every(Number.isFinite))
    .map(([latitude, longitude]) => ({ latitude, longitude }));
  if (points.length < 3) return undefined;
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return undefined;
  return first.latitude === last.latitude && first.longitude === last.longitude
    ? points
    : [...points, first];
}

export class NcdrClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NcdrClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.NCDR_API_KEY;
    this.baseUrl = options.baseUrl ?? "https://alerts.ncdr.nat.gov.tw";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchCity(city: CityName): Promise<CityFeedResult> {
    const fetchedAt = now();
    if (!this.apiKey) {
      return makeFeedResult("ncdr", "unavailable", fetchedAt, [], [], "NCDR_API_KEY 未設定");
    }
    try {
      const url = new URL(`${this.baseUrl}/api/datastore`);
      url.searchParams.set("apikey", this.apiKey);
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "100");
      const response = await this.fetchImpl(url);
      if (!response.ok) throw new Error(`NCDR 回傳 ${response.status}`);
      const data = NcdCollectionSchema.parse(await response.json());
      const records = Array.isArray(data) ? data : (data.data ?? data.records ?? data.result ?? []);
      const target = cityLabel(city);
      const observations: CityObservation[] = [];
      const signals = [];
      for (const record of records) {
        const text = `${record.alerttitle ?? ""} ${record.content ?? ""}`.trim();
        const area = record.areaDesc ?? "";
        if (!text || (area && !area.includes(target))) continue;
        const polygon = parsePolygon(record.polygon);
        const id = observationId("ncdr", record.capid ?? record.capcode ?? text.slice(0, 24));
        const summary = `${target}：${record.alerttitle ?? record.content ?? "災害示警"}`;
        const severity = /重大|嚴重|警報/.test(text) ? "severe" : "warning";
        observations.push(
          CityObservationSchema.parse({
            id,
            source: "ncdr",
            kind: "disaster_alert",
            severity,
            ...(polygon ? { polygon } : {}),
            observedAt: isoTimestamp(record.effectivetime, fetchedAt),
            fetchedAt,
            evidenceId: evidenceId("ncdr", id),
            summary,
          }),
        );
        if (polygon && /淹水|積水|洪水|道路封閉/.test(text)) {
          signals.push(
            RouteSignalSchema.parse({
              id,
              kind: /道路封閉/.test(text) ? "road_closure" : "flood_zone",
              polygon,
              ...(/道路封閉/.test(text)
                ? { severity: "blocked" }
                : { severity: /重大|嚴重|警報/.test(text) ? "blocked" : "warning" }),
              label: record.alerttitle ?? "NCDR 災害區域",
              observedAt: isoTimestamp(record.effectivetime, fetchedAt),
              expiresAt: isoTimestamp(record.expirestime, signalExpiry(fetchedAt)),
              evidenceId: evidenceId("ncdr", id),
              summary,
            }),
          );
        }
      }
      return makeFeedResult("ncdr", "fresh", fetchedAt, observations, signals);
    } catch (error) {
      return makeFeedResult(
        "ncdr",
        "unavailable",
        fetchedAt,
        [],
        [],
        error instanceof Error ? error.message : "NCDR 資料無法取得",
      );
    }
  }
}
