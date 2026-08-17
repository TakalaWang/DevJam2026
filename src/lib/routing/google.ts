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
} from "../../contracts";
import { z } from "zod";

const GoogleTravelModeSchema = z.enum(["DRIVE", "BICYCLE", "WALK"]);

const GoogleComputeRoutesRequestSchema = z.object({
  origin: z.object({ location: z.object({ latLng: CoordinateSchema }) }),
  destination: z.object({ location: z.object({ latLng: CoordinateSchema }) }),
  travelMode: GoogleTravelModeSchema,
  routingPreference: z.enum(["TRAFFIC_AWARE", "TRAFFIC_AWARE_OPTIMAL"]).optional(),
  computeAlternativeRoutes: z.boolean(),
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

const GoogleRoutesResponseSchema = z.object({ routes: z.array(GoogleRouteSchema).min(1) });

export type GoogleRoutesProviderOptions = {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

function travelMode(profile: RouteProfile): z.infer<typeof GoogleTravelModeSchema> {
  return profile === "car" ? "DRIVE" : profile === "bike" ? "BICYCLE" : "WALK";
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
    id: `google-${profile}-${index + 1}`,
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
    const body = GoogleComputeRoutesRequestSchema.parse({
      origin: { location: { latLng: request.origin.coordinate } },
      destination: { location: { latLng: request.destination.coordinate } },
      travelMode: travelMode(input.profile),
      ...(input.profile === "car" ? { routingPreference: "TRAFFIC_AWARE" } : {}),
      computeAlternativeRoutes: true,
      languageCode: "zh-TW",
      units: "METRIC",
      ...(request.departureAt ? { departureTime: request.departureAt } : {}),
    });

    try {
      const response = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
          "x-goog-fieldmask":
            "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        return RouteProviderResultSchema.parse({
          status: "unavailable",
          reason:
            response.status === 429
              ? "Google Routes API 配額已達上限，請稍後再試"
              : `Google Routes 回傳 ${response.status}`,
        });
      }
      const data = GoogleRoutesResponseSchema.parse(await response.json());
      return RouteProviderResultSchema.parse({
        status: "ok",
        paths: data.routes.map((route, index) => toRoutePath(input.profile, index, route)),
      });
    } catch (error) {
      return RouteProviderResultSchema.parse({
        status: "unavailable",
        reason: error instanceof Error ? error.message : "Google Routes 服務無法使用",
      });
    }
  }
}
