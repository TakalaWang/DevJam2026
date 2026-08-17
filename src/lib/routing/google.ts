import {
  CoordinateSchema,
  RouteCalculationInputSchema,
  RoutePathSchema,
  RouteProviderResultSchema,
  RouteRequestSchema,
  type Coordinate,
  type RouteCalculationInput,
  type RoutePath,
  type RouteProfile,
  type RouteProviderResult,
  type RouteSignal,
  type RiskPolygon,
} from "../../contracts";
import { z } from "zod";
import { createCombinedDetourWaypointPairs, createDetourWaypointPairs } from "./geometry";

const GoogleTravelModeSchema = z.enum(["DRIVE", "BICYCLE", "WALK"]);
const GoogleWaypointSchema = z.object({
  location: z.object({ latLng: CoordinateSchema }),
  via: z.boolean().optional(),
});
const GoogleRouteModifiersSchema = z
  .object({
    avoidTolls: z.boolean().optional(),
    avoidHighways: z.boolean().optional(),
    avoidFerries: z.boolean().optional(),
    avoidIndoor: z.boolean().optional(),
  })
  .partial();

const GoogleComputeRoutesRequestSchema = z.object({
  origin: z.object({ location: z.object({ latLng: CoordinateSchema }) }),
  destination: z.object({ location: z.object({ latLng: CoordinateSchema }) }),
  intermediates: z.array(GoogleWaypointSchema).max(25).optional(),
  travelMode: GoogleTravelModeSchema,
  routingPreference: z.enum(["TRAFFIC_AWARE", "TRAFFIC_AWARE_OPTIMAL"]).optional(),
  computeAlternativeRoutes: z.boolean().optional(),
  routeModifiers: GoogleRouteModifiersSchema.optional(),
  languageCode: z.string().min(1),
  units: z.literal("METRIC"),
  departureTime: z.string().datetime({ offset: true }).optional(),
});

const GoogleStepSchema = z.object({
  distanceMeters: z.number().nonnegative().optional(),
  staticDuration: z.string().min(1).optional(),
  navigationInstruction: z.object({ instructions: z.string().min(1) }).optional(),
});

const GoogleRouteSchema = z.object({
  distanceMeters: z.number().nonnegative(),
  duration: z.string().min(1),
  polyline: z.object({ encodedPolyline: z.string().min(1) }),
  legs: z.array(z.object({ steps: z.array(GoogleStepSchema).default([]) })).default([]),
});

const GoogleRoutesResponseSchema = z.object({ routes: z.array(GoogleRouteSchema) });

type GoogleRouteVariant = {
  label: string;
  computeAlternativeRoutes: boolean;
  intermediates?: Coordinate[];
  routeModifiers?: z.infer<typeof GoogleRouteModifiersSchema>;
};

type GoogleQueryResult =
  { status: "ok"; paths: RoutePath[] } | { status: "unavailable"; reason: string };

export type GoogleRoutesProviderOptions = {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

function travelMode(profile: RouteProfile): z.infer<typeof GoogleTravelModeSchema> {
  return profile === "car" ? "DRIVE" : profile === "bike" ? "BICYCLE" : "WALK";
}

function isHardAreaSignal(signal: RouteSignal): boolean {
  return (
    signal.kind === "road_closure" ||
    (signal.kind === "flood_zone" && signal.severity === "blocked") ||
    (signal.kind === "station_disruption" && signal.status !== "delayed") ||
    (signal.kind === "low_lighting" && signal.severity === "blocked")
  );
}

function signalPolygon(signal: RouteSignal): RiskPolygon | undefined {
  switch (signal.kind) {
    case "flood_zone":
    case "road_closure":
    case "station_disruption":
    case "traffic":
    case "low_lighting":
      return signal.polygon;
    case "bike_station":
      return undefined;
  }
}

function variantsFor(
  profile: RouteProfile,
  request: z.infer<typeof GoogleComputeRoutesRequestSchema>,
  signals: RouteSignal[],
): GoogleRouteVariant[] {
  const variants: GoogleRouteVariant[] = [
    {
      label: "baseline",
      computeAlternativeRoutes: true,
      ...(request.intermediates
        ? { intermediates: request.intermediates.map((item) => item.location.latLng) }
        : {}),
    },
  ];
  if (!signals.length) return variants;

  if (profile === "car") {
    variants.push(
      {
        label: "avoid-highways",
        computeAlternativeRoutes: true,
        routeModifiers: { avoidHighways: true },
      },
      {
        label: "avoid-tolls",
        computeAlternativeRoutes: true,
        routeModifiers: { avoidTolls: true },
      },
      {
        label: "avoid-ferries",
        computeAlternativeRoutes: true,
        routeModifiers: { avoidFerries: true },
      },
      {
        label: "avoid-all-road-risks",
        computeAlternativeRoutes: true,
        routeModifiers: { avoidHighways: true, avoidTolls: true, avoidFerries: true },
      },
    );
  }
  if (profile === "foot") {
    variants.push({
      label: "avoid-indoor",
      computeAlternativeRoutes: true,
      routeModifiers: { avoidIndoor: true },
    });
  }

  const hardPolygons = signals
    .filter(isHardAreaSignal)
    .map(signalPolygon)
    .filter((polygon): polygon is RiskPolygon => Boolean(polygon));
  const combinedDetours = createCombinedDetourWaypointPairs(
    hardPolygons,
    request.origin.location.latLng,
    request.destination.location.latLng,
  ).map((intermediates, index) => ({
    label: `combined-detour-${index + 1}`,
    computeAlternativeRoutes: false,
    intermediates,
  }));
  const individualDetours = signals
    .filter(isHardAreaSignal)
    .flatMap((signal) => {
      const polygon = signalPolygon(signal);
      return polygon
        ? createDetourWaypointPairs(
            polygon,
            request.origin.location.latLng,
            request.destination.location.latLng,
          )
        : [];
    })
    .slice(0, 4)
    .map((intermediates, index) => ({
      label: `detour-${index + 1}`,
      computeAlternativeRoutes: false,
      intermediates,
    }));
  return [...variants, ...combinedDetours.slice(0, 4), ...individualDetours].slice(0, 11);
}

function parseDuration(value: string): number {
  const seconds = Number(value.replace(/s$/, ""));
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Google Routes 回傳無效時間");
  return seconds;
}

function readPolylineValue(encoded: string, start: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let index = start;
  while (true) {
    if (index >= encoded.length) throw new Error("Google Routes 回傳無效 polyline");
    const byte = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
    if (byte < 0x20) break;
  }
  return { value: (result & 1) === 1 ? ~(result >> 1) : result >> 1, next: index };
}

function decodePolyline(encoded: string): Coordinate[] {
  const coordinates: Coordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const latitudeValue = readPolylineValue(encoded, index);
    const longitudeValue = readPolylineValue(encoded, latitudeValue.next);
    index = longitudeValue.next;
    latitude += latitudeValue.value;
    longitude += longitudeValue.value;
    coordinates.push(
      CoordinateSchema.parse({ latitude: latitude / 100_000, longitude: longitude / 100_000 }),
    );
  }
  if (coordinates.length < 2) throw new Error("Google Routes 回傳的 polyline 太短");
  return coordinates;
}

function toRoutePath(
  profile: RouteProfile,
  index: number,
  variant: string,
  route: z.infer<typeof GoogleRouteSchema>,
): RoutePath {
  const instructions = route.legs.flatMap((leg) =>
    leg.steps.flatMap((step) => {
      const text = step.navigationInstruction?.instructions;
      return text
        ? [
            {
              text,
              distanceMeters: step.distanceMeters ?? 0,
              durationSeconds: parseDuration(step.staticDuration ?? "0s"),
            },
          ]
        : [];
    }),
  );
  return RoutePathSchema.parse({
    id: `google-${profile}-${variant}-${index + 1}`,
    profile,
    coordinates: decodePolyline(route.polyline.encodedPolyline),
    distanceMeters: route.distanceMeters,
    durationSeconds: Math.ceil(parseDuration(route.duration)),
    stationIds: [],
    instructions,
    provider: "google",
  });
}

export class GoogleRoutesProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoogleRoutesProviderOptions = {}) {
    this.baseUrl =
      options.baseUrl ??
      process.env.GOOGLE_ROUTES_BASE_URL ??
      "https://routes.googleapis.com/directions/v2:computeRoutes";
    this.apiKey = options.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async calculate(rawInput: RouteCalculationInput): Promise<RouteProviderResult> {
    const input = RouteCalculationInputSchema.parse(rawInput);
    const request = RouteRequestSchema.parse(input.request);
    if (!this.apiKey) {
      return RouteProviderResultSchema.parse({
        status: "unavailable",
        reason: "Google Routes API 未設定 API key",
      });
    }
    const baseRequest = GoogleComputeRoutesRequestSchema.parse({
      origin: { location: { latLng: request.origin.coordinate } },
      destination: { location: { latLng: request.destination.coordinate } },
      travelMode: travelMode(input.profile),
      ...(input.profile === "car" ? { routingPreference: "TRAFFIC_AWARE" } : {}),
      languageCode: "zh-TW",
      units: "METRIC",
      ...(request.departureAt ? { departureTime: request.departureAt } : {}),
    });
    const variants = variantsFor(input.profile, baseRequest, input.blockedSignals);
    const results = await Promise.all(
      variants.map((variant) => this.query(input.profile, baseRequest, variant)),
    );
    const paths = results.flatMap((result) => (result.status === "ok" ? result.paths : []));
    if (paths.length) return RouteProviderResultSchema.parse({ status: "ok", paths });
    return RouteProviderResultSchema.parse({
      status: "unavailable",
      reason:
        results.find((result) => result.status === "unavailable")?.reason ??
        "Google Routes 沒有回傳可用路線",
    });
  }

  private async query(
    profile: RouteProfile,
    baseRequest: z.infer<typeof GoogleComputeRoutesRequestSchema>,
    variant: GoogleRouteVariant,
  ): Promise<GoogleQueryResult> {
    const body = GoogleComputeRoutesRequestSchema.parse({
      ...baseRequest,
      computeAlternativeRoutes: variant.computeAlternativeRoutes,
      ...(variant.intermediates
        ? {
            intermediates: variant.intermediates.map((coordinate) => ({
              location: { latLng: coordinate },
              via: true,
            })),
          }
        : {}),
      ...(variant.routeModifiers ? { routeModifiers: variant.routeModifiers } : {}),
    });
    try {
      const response = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey ?? "",
          "x-goog-fieldmask":
            "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const details = (await response.text()).trim();
        return {
          status: "unavailable",
          reason:
            response.status === 429
              ? "Google Routes API 配額已達上限，請稍後再試"
              : response.status === 403
                ? `Google Routes 回傳 403：請確認 Routes API、billing 與 server key restriction${details ? `（${details.slice(0, 180)}）` : ""}`
                : `Google Routes 回傳 ${response.status}`,
        };
      }
      const data = GoogleRoutesResponseSchema.parse(await response.json());
      if (!data.routes.length)
        return { status: "unavailable", reason: "Google Routes 沒有找到路線" };
      return {
        status: "ok",
        paths: data.routes.map((route, index) => toRoutePath(profile, index, variant.label, route)),
      };
    } catch (error) {
      return {
        status: "unavailable",
        reason: error instanceof Error ? error.message : "Google Routes 服務無法使用",
      };
    }
  }
}
