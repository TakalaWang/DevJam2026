import {
  CityObservationSchema,
  RouteSignalSchema,
  type CityFeedResult,
  type CityName,
  type CityObservation,
  type RouteSignal,
} from "../../contracts";
import { pointInPolygon } from "../routing/geometry";
import {
  cityPolygon,
  circlePolygon,
  evidenceId,
  isoTimestamp,
  makeFeedResult,
  now,
  observationId,
  signalExpiry,
} from "./common";
import { z } from "zod";

const TdxPositionSchema = z
  .object({
    PositionLat: z.coerce.number().min(-90).max(90),
    PositionLon: z.coerce.number().min(-180).max(180),
  })
  .optional();

const TdxNameSchema = z
  .object({ Zh_tw: z.string().optional(), En: z.string().optional() })
  .optional();

const TdxBikeRecordSchema = z.object({
  StationUID: z.string().optional(),
  StationID: z.string().optional(),
  StationName: TdxNameSchema,
  StationPosition: TdxPositionSchema,
  ServiceStatus: z.coerce.number().int().optional(),
  UpdateTime: z.string().optional(),
});

const TdxBikeAvailabilityRecordSchema = z.object({
  StationUID: z.string().optional(),
  StationID: z.string().optional(),
  AvailableRentBikes: z.coerce.number().int().nonnegative(),
  AvailableReturnBikes: z.coerce.number().int().nonnegative(),
  ServiceStatus: z.coerce.number().int().optional(),
  UpdateTime: z.string().optional(),
});

const TdxTrafficRecordSchema = z.object({
  CongestionLevel: z.coerce.string().min(1),
  DataCollectTime: z.string().optional(),
  SectionID: z.string().optional(),
  RoadID: z.string().optional(),
  RoadName: z.string().optional(),
  TravelSpeed: z.coerce.number().optional(),
  TravelTime: z.coerce.number().optional(),
  PositionLat: z.coerce.number().min(-90).max(90).optional(),
  PositionLon: z.coerce.number().min(-180).max(180).optional(),
  UpdateTime: z.string().optional(),
});

const TdxRoadEventRecordSchema = z.object({
  EventID: z.string().optional(),
  EventTitle: z.string().optional(),
  EventType: z.coerce.number().int().optional(),
  EventSubType: z.coerce.number().int().optional(),
  Description: z.string().optional(),
  Positions: z.string().optional(),
  EffectiveTime: z.string().optional(),
  ExpireTime: z.string().optional(),
  LastUpdateTime: z.string().optional(),
});

const TdxAlertRecordSchema = z.object({
  AlertID: z.string().optional(),
  StationID: z.string().optional(),
  Title: z.string().optional(),
  Description: z.string().optional(),
  Effect: z.string().optional(),
  Scope: z.string().optional(),
  Status: z.string().optional(),
  RouteName: z.string().optional(),
  StartTime: z.string().optional(),
  EndTime: z.string().optional(),
  UpdateTime: z.string().optional(),
});

const TdxTrainDelayRecordSchema = z.object({
  StationID: z.string().optional(),
  StationName: z.string().optional(),
  TrainNo: z.string().optional(),
  DelayTime: z.coerce.number().int().nonnegative(),
  UpdateTime: z.string().optional(),
});

const TdxBikeCollectionSchema = z.union([
  z.array(TdxBikeRecordSchema),
  z.object({ value: z.array(TdxBikeRecordSchema) }),
]);
const TdxBikeAvailabilityCollectionSchema = z.array(TdxBikeAvailabilityRecordSchema);
const TdxTrafficCollectionSchema = z.union([
  z.array(TdxTrafficRecordSchema),
  z.object({ LiveTraffics: z.array(TdxTrafficRecordSchema) }),
]);
const TdxRoadEventCollectionSchema = z.union([
  z.array(TdxRoadEventRecordSchema),
  z.object({ LiveEvents: z.array(TdxRoadEventRecordSchema) }),
]);
const TdxAlertCollectionSchema = z.union([
  z.array(TdxAlertRecordSchema),
  z.object({ value: z.array(TdxAlertRecordSchema) }),
  z.object({ Alerts: z.array(TdxAlertRecordSchema) }),
]);
const TdxTrainDelayCollectionSchema = z.array(TdxTrainDelayRecordSchema);

export type TdxClientOptions = {
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: typeof fetch;
  requestIntervalMs?: number;
};

const TdxTokenSchema = z.object({ access_token: z.string().min(1) });
const TDX_REQUEST_INTERVAL_MS = 1_000;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function records<T>(collection: T[] | { value: T[] } | { Alerts: T[] }): T[] {
  if (Array.isArray(collection)) return collection;
  return "value" in collection ? collection.value : collection.Alerts;
}

function trafficRecords(
  collection: z.infer<typeof TdxTrafficCollectionSchema>,
): z.infer<typeof TdxTrafficRecordSchema>[] {
  return Array.isArray(collection) ? collection : collection.LiveTraffics;
}

function roadEventRecords(
  collection: z.infer<typeof TdxRoadEventCollectionSchema>,
): z.infer<typeof TdxRoadEventRecordSchema>[] {
  return Array.isArray(collection) ? collection : collection.LiveEvents;
}

function parseEventPoint(value: string | undefined) {
  if (!value) return undefined;
  const numbers = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const [first, second] = numbers;
  if (first === undefined || second === undefined) return undefined;
  if (/POINT/i.test(value)) {
    return { latitude: second, longitude: first };
  }
  return { latitude: first, longitude: second };
}

function trafficLevel(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function readPosition(position: z.infer<typeof TdxPositionSchema>) {
  return position ? { latitude: position.PositionLat, longitude: position.PositionLon } : undefined;
}

function observedAt(value: string | undefined, fetchedAt: string): string {
  return isoTimestamp(value, fetchedAt);
}

export class TdxClient {
  private readonly baseUrl: string;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly requestIntervalMs: number;
  private cachedToken: { value: string; expiresAt: number } | undefined;
  private nextRequestAt = 0;

  constructor(options: TdxClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.TDX_BASE_URL ?? "https://tdx.transportdata.tw";
    this.clientId = options.clientId ?? process.env.TDX_CLIENT_ID;
    this.clientSecret = options.clientSecret ?? process.env.TDX_CLIENT_SECRET;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestIntervalMs = options.requestIntervalMs ?? TDX_REQUEST_INTERVAL_MS;
  }

  async fetchCity(city: CityName): Promise<CityFeedResult> {
    const fetchedAt = now();
    if (!this.clientId || !this.clientSecret) {
      return makeFeedResult(
        "tdx",
        "unavailable",
        fetchedAt,
        [],
        [],
        "TDX_CLIENT_ID／TDX_CLIENT_SECRET 未設定",
      );
    }
    try {
      const token = await this.token();
      const collect = <T extends z.ZodType>(path: string, schema: T) =>
        this.collection(path, token, schema).catch(() => undefined);
      const bikeStations = await collect(
        "/api/basic/v2/Bike/Station/City/" + city,
        TdxBikeCollectionSchema,
      );
      const bikeAvailability = await collect(
        "/api/basic/v2/Bike/Availability/City/" + city,
        TdxBikeAvailabilityCollectionSchema,
      );
      const traffic = await collect(
        "/api/basic/v2/Road/Traffic/Live/City/" + city,
        TdxTrafficCollectionSchema,
      );
      const roadEvents = await collect(
        "/api/basic/v1/Traffic/RoadEvent/LiveEvent/City/" + city,
        TdxRoadEventCollectionSchema,
      );
      const metroAlerts = await collect(
        "/api/basic/v2/Rail/Metro/Alert/TRTC",
        TdxAlertCollectionSchema,
      );
      const busAlerts = await collect(
        "/api/basic/v2/Bus/Alert/City/" + city,
        TdxAlertCollectionSchema,
      );
      const traDelays = await collect(
        "/api/basic/v2/Rail/TRA/LiveTrainDelay",
        TdxTrainDelayCollectionSchema,
      );
      const thsrAlerts = await collect(
        "/api/basic/v2/Rail/THSR/AlertInfo",
        TdxAlertCollectionSchema,
      );
      if (
        !bikeStations &&
        !bikeAvailability &&
        !traffic &&
        !roadEvents &&
        !metroAlerts &&
        !busAlerts &&
        !traDelays &&
        !thsrAlerts
      ) {
        throw new Error("TDX 各資料服務皆無法取得");
      }
      const observations: CityObservation[] = [];
      const signals: RouteSignal[] = [];
      if (bikeStations && bikeAvailability)
        this.mapBikes(
          city,
          fetchedAt,
          records(bikeStations),
          bikeAvailability,
          observations,
          signals,
        );
      if (traffic) this.mapTraffic(city, fetchedAt, trafficRecords(traffic), observations, signals);
      if (roadEvents)
        this.mapRoadEvents(city, fetchedAt, roadEventRecords(roadEvents), observations, signals);
      if (metroAlerts) this.mapAlerts("metro", fetchedAt, records(metroAlerts), observations);
      if (busAlerts) this.mapAlerts("bus", fetchedAt, records(busAlerts), observations);
      if (traDelays) this.mapTrainDelays(fetchedAt, traDelays, observations);
      if (thsrAlerts) this.mapAlerts("thsr", fetchedAt, records(thsrAlerts), observations);
      return makeFeedResult("tdx", "fresh", fetchedAt, observations, signals);
    } catch (error) {
      return makeFeedResult(
        "tdx",
        "unavailable",
        fetchedAt,
        [],
        [],
        error instanceof Error ? error.message : "TDX 資料無法取得",
      );
    }
  }

  private async token(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.value;
    }
    const response = await this.fetchImpl(
      `${this.baseUrl}/auth/realms/TDXConnect/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.clientId ?? "",
          client_secret: this.clientSecret ?? "",
        }),
      },
    );
    if (!response.ok) throw new Error(`TDX token 回傳 ${response.status}`);
    const payload = TdxTokenSchema.parse(await response.json());
    this.cachedToken = { value: payload.access_token, expiresAt: Date.now() + 55 * 60_000 };
    return payload.access_token;
  }

  private async collection<T extends z.ZodType>(
    path: string,
    token: string,
    schema: T,
  ): Promise<z.infer<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("$top", "200");
    url.searchParams.set("$format", "JSON");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const delay = Math.max(0, this.nextRequestAt - Date.now());
      if (delay > 0) await wait(delay);
      this.nextRequestAt = Date.now() + this.requestIntervalMs;
      const response = await this.fetchImpl(url, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.status === 429 && attempt === 0) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "1");
        await wait(
          Math.min(
            Math.max(Number.isFinite(retryAfter) ? retryAfter * 1_000 : 2_000, 1_000),
            10_000,
          ),
        );
        continue;
      }
      if (!response.ok) throw new Error(`TDX ${path} 回傳 ${response.status}`);
      return schema.parse(await response.json()) as z.infer<T>;
    }
    throw new Error(`TDX ${path} 重試後仍被限流`);
  }

  private mapBikes(
    city: CityName,
    fetchedAt: string,
    stations: z.infer<typeof TdxBikeRecordSchema>[],
    availability: z.infer<typeof TdxBikeAvailabilityRecordSchema>[],
    observations: CityObservation[],
    signals: RouteSignal[],
  ): void {
    const area = cityPolygon(city);
    const availabilityByStation = new Map(
      availability.flatMap((record) => {
        const stationId = record.StationUID ?? record.StationID;
        return stationId ? [[stationId, record] as const] : [];
      }),
    );
    for (const record of stations) {
      const coordinate = readPosition(record.StationPosition);
      const stationId = record.StationUID ?? record.StationID;
      const live = stationId ? availabilityByStation.get(stationId) : undefined;
      if (!coordinate || !stationId || !live || !pointInPolygon(coordinate, area)) continue;
      const availableBikes = live.AvailableRentBikes;
      const availableDocks = live.AvailableReturnBikes;
      const id = observationId("tdx", `bike-${stationId}`);
      const summary = `${record.StationName?.Zh_tw ?? stationId}：可借 ${availableBikes} 台、可還 ${availableDocks} 位`;
      observations.push(
        CityObservationSchema.parse({
          id,
          source: "tdx",
          kind: "bike_station",
          stationId,
          coordinate,
          availableBikes,
          availableDocks,
          observedAt: observedAt(live.UpdateTime ?? record.UpdateTime, fetchedAt),
          fetchedAt,
          evidenceId: evidenceId("tdx", id),
          summary,
        }),
      );
      if (availableBikes === 0 || availableDocks === 0) {
        signals.push(
          RouteSignalSchema.parse({
            id,
            kind: "bike_station",
            stationId,
            coordinate,
            availableBikes,
            availableDocks,
            label: record.StationName?.Zh_tw ?? stationId,
            observedAt: observedAt(live.UpdateTime ?? record.UpdateTime, fetchedAt),
            expiresAt: signalExpiry(fetchedAt),
            evidenceId: evidenceId("tdx", id),
            summary,
          }),
        );
      }
    }
  }

  private mapTraffic(
    city: CityName,
    fetchedAt: string,
    input: z.infer<typeof TdxTrafficRecordSchema>[],
    observations: CityObservation[],
    signals: RouteSignal[],
  ): void {
    const area = cityPolygon(city);
    for (const record of input) {
      const coordinate =
        record.PositionLat !== undefined && record.PositionLon !== undefined
          ? { latitude: record.PositionLat, longitude: record.PositionLon }
          : undefined;
      if (coordinate && !pointInPolygon(coordinate, area)) continue;
      const congestionLevel = trafficLevel(record.CongestionLevel);
      const delaySeconds = Math.max(congestionLevel - 1, 0) * 180;
      const id = observationId(
        "tdx",
        `traffic-${record.SectionID ?? record.RoadID ?? record.RoadName ?? fetchedAt}`,
      );
      const polygon = coordinate ? circlePolygon(coordinate, 0.003) : undefined;
      const summary = `${record.RoadName ?? "道路"} 壅塞等級 ${congestionLevel}，估計增加 ${delaySeconds} 秒`;
      observations.push(
        CityObservationSchema.parse({
          id,
          source: "tdx",
          kind: "traffic",
          ...(polygon ? { polygon } : {}),
          congestionLevel,
          delaySeconds,
          observedAt: observedAt(record.DataCollectTime ?? record.UpdateTime, fetchedAt),
          fetchedAt,
          evidenceId: evidenceId("tdx", id),
          summary,
        }),
      );
      if (polygon && congestionLevel >= 2) {
        signals.push(
          RouteSignalSchema.parse({
            id,
            kind: "traffic",
            polygon,
            delaySeconds,
            severity: congestionLevel >= 4 ? "critical" : "warning",
            label: record.RoadName ?? "即時壅塞路段",
            observedAt: observedAt(record.DataCollectTime ?? record.UpdateTime, fetchedAt),
            expiresAt: signalExpiry(fetchedAt),
            evidenceId: evidenceId("tdx", id),
            summary,
          }),
        );
      }
    }
  }

  private mapRoadEvents(
    city: CityName,
    fetchedAt: string,
    input: z.infer<typeof TdxRoadEventRecordSchema>[],
    observations: CityObservation[],
    signals: RouteSignal[],
  ): void {
    const area = cityPolygon(city);
    for (const record of input) {
      const coordinate = parseEventPoint(record.Positions);
      if (coordinate && !pointInPolygon(coordinate, area)) continue;
      const id = observationId("tdx", `event-${record.EventID ?? record.EventTitle ?? fetchedAt}`);
      const polygon = coordinate ? circlePolygon(coordinate, 0.002) : undefined;
      const summary = `${record.EventTitle ?? "道路事件"}：${record.Description ?? ""}`.replace(
        /：$/,
        "",
      );
      const blocked =
        /封閉|封路|淹水|施工|事故|積水|路燈故障/.test(
          `${record.EventTitle ?? ""}${record.Description ?? ""}`,
        ) || [402, 605, 804, 806].includes(record.EventSubType ?? 0);
      observations.push(
        CityObservationSchema.parse({
          id,
          source: "tdx",
          kind: "road_event",
          ...(polygon ? { polygon } : {}),
          status: "active",
          observedAt: observedAt(record.LastUpdateTime ?? record.EffectiveTime, fetchedAt),
          fetchedAt,
          evidenceId: evidenceId("tdx", id),
          summary,
        }),
      );
      if (polygon) {
        signals.push(
          RouteSignalSchema.parse({
            id,
            kind: blocked ? "road_closure" : "traffic",
            ...(blocked
              ? { polygon, severity: "blocked" }
              : { polygon, severity: "warning", delaySeconds: 300 }),
            label: record.EventTitle ?? "道路事件",
            observedAt: observedAt(record.LastUpdateTime ?? record.EffectiveTime, fetchedAt),
            expiresAt: record.ExpireTime
              ? observedAt(record.ExpireTime, signalExpiry(fetchedAt))
              : signalExpiry(fetchedAt),
            evidenceId: evidenceId("tdx", id),
            summary,
          }),
        );
      }
    }
  }

  private mapAlerts(
    mode: "metro" | "bus" | "tra" | "thsr",
    fetchedAt: string,
    input: z.infer<typeof TdxAlertRecordSchema>[],
    observations: CityObservation[],
  ): void {
    for (const record of input) {
      const id = observationId(
        "tdx",
        `alert-${mode}-${record.AlertID ?? record.StationID ?? record.RouteName ?? fetchedAt}`,
      );
      const text =
        `${record.Title ?? ""} ${record.Description ?? ""} ${record.Effect ?? ""} ${record.Status ?? ""}`.trim();
      observations.push(
        CityObservationSchema.parse({
          id,
          source: "tdx",
          kind: "transit_alert",
          mode,
          ...(record.RouteName ? { serviceId: record.RouteName } : {}),
          status: /停駛|中斷|關閉|suspend|close|cancel/i.test(text) ? "suspended" : "delayed",
          observedAt: observedAt(record.UpdateTime ?? record.StartTime, fetchedAt),
          fetchedAt,
          evidenceId: evidenceId("tdx", id),
          summary: text || `${mode} 服務狀態異動`,
        }),
      );
    }
  }

  private mapTrainDelays(
    fetchedAt: string,
    input: z.infer<typeof TdxTrainDelayRecordSchema>[],
    observations: CityObservation[],
  ): void {
    for (const record of input) {
      const id = observationId(
        "tdx",
        `tra-delay-${record.TrainNo ?? record.StationID ?? fetchedAt}`,
      );
      observations.push(
        CityObservationSchema.parse({
          id,
          source: "tdx",
          kind: "transit_alert",
          mode: "tra",
          ...(record.TrainNo ? { serviceId: record.TrainNo } : {}),
          status: record.DelayTime > 0 ? "delayed" : "unavailable",
          observedAt: observedAt(record.UpdateTime, fetchedAt),
          fetchedAt,
          evidenceId: evidenceId("tdx", id),
          summary: `${record.StationName ?? record.StationID ?? "臺鐵"} ${record.TrainNo ?? "列車"} 延誤 ${record.DelayTime} 分鐘`,
        }),
      );
    }
  }
}
