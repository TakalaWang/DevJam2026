import { z } from "zod";
import { CoordinateSchema, RouteSignalSchema, RiskPolygonSchema } from "./route";

export const CityNameSchema = z.enum(["Taipei", "NewTaipei"]);
export type CityName = z.infer<typeof CityNameSchema>;

export const CityFeedSourceSchema = z.enum(["tdx", "cwa", "ncdr", "taipei_metro", "data_taipei"]);
export type CityFeedSource = z.infer<typeof CityFeedSourceSchema>;

export const CityFeedStatusSchema = z.enum(["fresh", "stale", "unavailable"]);
export type CityFeedStatus = z.infer<typeof CityFeedStatusSchema>;

const CityObservationBaseSchema = {
  id: z.string().min(1),
  source: CityFeedSourceSchema,
  observedAt: z.string().datetime({ offset: true }),
  fetchedAt: z.string().datetime({ offset: true }),
  evidenceId: z.string().min(1),
  summary: z.string().min(1),
};

export const CityObservationSchema = z.discriminatedUnion("kind", [
  z.object({
    ...CityObservationBaseSchema,
    kind: z.literal("traffic"),
    polygon: RiskPolygonSchema.optional(),
    congestionLevel: z.number().int().nonnegative(),
    delaySeconds: z.number().int().nonnegative(),
  }),
  z.object({
    ...CityObservationBaseSchema,
    kind: z.literal("road_event"),
    polygon: RiskPolygonSchema.optional(),
    status: z.enum(["active", "cleared", "stale"]),
  }),
  z.object({
    ...CityObservationBaseSchema,
    kind: z.literal("bike_station"),
    stationId: z.string().min(1),
    coordinate: CoordinateSchema,
    availableBikes: z.number().int().nonnegative(),
    availableDocks: z.number().int().nonnegative(),
  }),
  z.object({
    ...CityObservationBaseSchema,
    kind: z.literal("metro_crowding"),
    stationId: z.string().min(1),
    coordinate: CoordinateSchema,
    crowdLevel: z.enum(["normal", "high", "critical"]),
  }),
  z.object({
    ...CityObservationBaseSchema,
    kind: z.literal("transit_alert"),
    mode: z.enum(["metro", "bus", "thsr", "tra"]),
    serviceId: z.string().min(1).optional(),
    status: z.enum(["delayed", "suspended", "closed", "unavailable"]),
  }),
  z.object({
    ...CityObservationBaseSchema,
    kind: z.literal("weather_warning"),
    warningKind: z.enum(["heavy_rain", "typhoon", "strong_wind", "heat", "earthquake"]),
    severity: z.enum(["advisory", "warning", "severe", "critical"]),
    polygon: RiskPolygonSchema,
  }),
  z.object({
    ...CityObservationBaseSchema,
    kind: z.literal("disaster_alert"),
    severity: z.enum(["advisory", "warning", "severe", "critical"]),
    polygon: RiskPolygonSchema.optional(),
  }),
]);
export type CityObservation = z.infer<typeof CityObservationSchema>;

export const CityFeedResultSchema = z.object({
  source: CityFeedSourceSchema,
  status: CityFeedStatusSchema,
  fetchedAt: z.string().datetime({ offset: true }),
  observations: z.array(CityObservationSchema),
  signals: z.array(RouteSignalSchema),
  message: z.string().min(1).optional(),
});
export type CityFeedResult = z.infer<typeof CityFeedResultSchema>;

export const CityFeedSnapshotSchema = z.object({
  city: CityNameSchema,
  checkedAt: z.string().datetime({ offset: true }),
  feeds: z.array(CityFeedResultSchema),
  observations: z.array(CityObservationSchema),
  signals: z.array(RouteSignalSchema),
});
export type CityFeedSnapshot = z.infer<typeof CityFeedSnapshotSchema>;

export const CityFeedQuerySchema = z.object({ city: CityNameSchema.default("Taipei") });
export type CityFeedQuery = z.infer<typeof CityFeedQuerySchema>;
