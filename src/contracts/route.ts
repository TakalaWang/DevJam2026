import { z } from "zod";

export const RouteTimestampSchema = z.string().datetime({ offset: true });

export const CoordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type Coordinate = z.infer<typeof CoordinateSchema>;

export const RoutePointSchema = z.object({
  label: z.string().min(1),
  coordinate: CoordinateSchema,
});
export type RoutePoint = z.infer<typeof RoutePointSchema>;

export const RouteProfileSchema = z.enum(["car", "transit", "bike", "foot"]);
export type RouteProfile = z.infer<typeof RouteProfileSchema>;

export const BikeStationRequirementSchema = z.object({
  stationId: z.string().min(1),
  role: z.enum(["origin_pickup", "destination_dropoff"]),
});
export type BikeStationRequirement = z.infer<typeof BikeStationRequirementSchema>;

export const RouteRequestSchema = z.object({
  origin: RoutePointSchema,
  destination: RoutePointSchema,
  profiles: z.array(RouteProfileSchema).min(1).default(["car"]),
  departureAt: RouteTimestampSchema.optional(),
  maxExtraMinutes: z.number().int().nonnegative().default(20),
  bikeStations: z.array(BikeStationRequirementSchema).default([]),
});
export type RouteRequest = z.infer<typeof RouteRequestSchema>;

const SignalBaseSchema = {
  id: z.string().min(1),
  label: z.string().min(1),
  observedAt: RouteTimestampSchema,
  expiresAt: RouteTimestampSchema.optional(),
  evidenceId: z.string().min(1),
  summary: z.string().min(1),
};

export const RiskPolygonSchema = z
  .array(CoordinateSchema)
  .min(4)
  .refine(
    (points) =>
      points[0]?.latitude === points.at(-1)?.latitude &&
      points[0]?.longitude === points.at(-1)?.longitude,
    "風險區域 polygon 必須閉合",
  );
export type RiskPolygon = z.infer<typeof RiskPolygonSchema>;

export const RouteSignalSchema = z.discriminatedUnion("kind", [
  z.object({
    ...SignalBaseSchema,
    kind: z.literal("flood_zone"),
    polygon: RiskPolygonSchema,
    severity: z.enum(["warning", "blocked"]),
  }),
  z.object({
    ...SignalBaseSchema,
    kind: z.literal("road_closure"),
    polygon: RiskPolygonSchema,
    severity: z.literal("blocked"),
  }),
  z.object({
    ...SignalBaseSchema,
    kind: z.literal("station_disruption"),
    stationId: z.string().min(1),
    polygon: RiskPolygonSchema,
    status: z.enum(["delayed", "closed", "suspended"]),
    mode: z.enum(["metro", "bus", "thsr", "tra"]).optional(),
    serviceId: z.string().min(1).optional(),
  }),
  z.object({
    ...SignalBaseSchema,
    kind: z.literal("bike_station"),
    stationId: z.string().min(1),
    coordinate: CoordinateSchema,
    availableBikes: z.number().int().nonnegative(),
    availableDocks: z.number().int().nonnegative(),
  }),
  z.object({
    ...SignalBaseSchema,
    kind: z.literal("traffic"),
    polygon: RiskPolygonSchema,
    delaySeconds: z.number().int().nonnegative(),
    severity: z.enum(["warning", "critical"]),
  }),
  z.object({
    ...SignalBaseSchema,
    kind: z.literal("low_lighting"),
    polygon: RiskPolygonSchema,
    severity: z.enum(["warning", "blocked"]),
  }),
  z.object({
    ...SignalBaseSchema,
    kind: z.literal("metro_crowding"),
    stationId: z.string().min(1),
    polygon: RiskPolygonSchema,
    crowdLevel: z.enum(["normal", "high", "critical"]),
    severity: z.enum(["warning", "critical"]),
  }),
  z.object({
    ...SignalBaseSchema,
    kind: z.literal("weather_warning"),
    polygon: RiskPolygonSchema,
    warningKind: z.enum(["heavy_rain", "typhoon", "strong_wind", "heat", "earthquake"]),
    severity: z.enum(["advisory", "warning", "severe", "critical"]),
  }),
]);
export type RouteSignal = z.infer<typeof RouteSignalSchema>;

export const RouteInstructionSchema = z.object({
  text: z.string().min(1),
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
});

export const TransitStopSchema = z.object({
  name: z.string().min(1),
  coordinate: CoordinateSchema,
  platformCode: z.string().min(1).optional(),
  signageText: z.string().min(1).optional(),
  stopCode: z.string().min(1).optional(),
  wheelchairAccessibleEntrance: z.boolean().optional(),
});
export type TransitStop = z.infer<typeof TransitStopSchema>;

const TransitLineColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const TransitStepSchema = z.object({
  mode: z.enum(["bus", "metro", "train", "light_rail", "other"]),
  line: z.string().min(1).optional(),
  lineColor: TransitLineColorSchema.optional(),
  lineTextColor: TransitLineColorSchema.optional(),
  headsign: z.string().min(1).optional(),
  boardingStop: TransitStopSchema,
  alightingStop: TransitStopSchema,
  departureAt: RouteTimestampSchema.optional(),
  arrivalAt: RouteTimestampSchema.optional(),
  stopCount: z.number().int().nonnegative().optional(),
});
export type TransitStep = z.infer<typeof TransitStepSchema>;

export const RoutePathSchema = z.object({
  id: z.string().min(1),
  profile: RouteProfileSchema,
  coordinates: z.array(CoordinateSchema).min(2),
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  stationIds: z.array(z.string().min(1)).default([]),
  instructions: z.array(RouteInstructionSchema).default([]),
  transitSteps: z.array(TransitStepSchema).default([]),
  provider: z.literal("google"),
});
export type RoutePath = z.infer<typeof RoutePathSchema>;

export const RouteCalculationInputSchema = z.object({
  request: RouteRequestSchema,
  profile: RouteProfileSchema,
  blockedSignals: z.array(RouteSignalSchema),
});
export type RouteCalculationInput = z.infer<typeof RouteCalculationInputSchema>;

export const RouteProviderResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), paths: z.array(RoutePathSchema).min(1) }),
  z.object({ status: z.literal("unavailable"), reason: z.string().min(1) }),
]);
export type RouteProviderResult = z.infer<typeof RouteProviderResultSchema>;

export const RouteFindingCodeSchema = z.enum([
  "flooded_segment",
  "road_closed",
  "station_disrupted",
  "bike_unavailable",
  "bike_dock_unavailable",
  "traffic_delay",
  "low_lighting",
  "metro_crowding",
  "weather_warning",
]);
export type RouteFindingCode = z.infer<typeof RouteFindingCodeSchema>;

export const RouteFindingSchema = z.object({
  code: RouteFindingCodeSchema,
  severity: z.enum(["warning", "error"]),
  signalId: z.string().min(1),
  message: z.string().min(1),
});
export type RouteFinding = z.infer<typeof RouteFindingSchema>;

export const RouteEvaluationSchema = z.object({
  path: RoutePathSchema,
  allowed: z.boolean(),
  score: z.number().nonnegative(),
  findings: z.array(RouteFindingSchema),
});
export type RouteEvaluation = z.infer<typeof RouteEvaluationSchema>;

const RoutePlanBaseSchema = {
  id: z.string().min(1),
  request: RouteRequestSchema,
  evaluations: z.array(RouteEvaluationSchema),
  signals: z.array(RouteSignalSchema),
  generatedAt: RouteTimestampSchema,
  evidenceIds: z.array(z.string().min(1)),
};

export const RoutePlanSchema = z.discriminatedUnion("status", [
  z.object({
    ...RoutePlanBaseSchema,
    status: z.literal("ok"),
    baseline: RoutePathSchema,
    selected: RoutePathSchema,
    alternatives: z.array(RoutePathSchema),
    rerouted: z.boolean(),
    reason: z.string().min(1),
  }),
  z.object({
    ...RoutePlanBaseSchema,
    status: z.literal("no_safe_route"),
    baseline: RoutePathSchema.optional(),
    reason: z.string().min(1),
  }),
  z.object({
    ...RoutePlanBaseSchema,
    status: z.literal("unavailable"),
    baseline: RoutePathSchema.optional(),
    reason: z.string().min(1),
  }),
]);
export type RoutePlan = z.infer<typeof RoutePlanSchema>;
