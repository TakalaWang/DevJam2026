import {
  CoordinateSchema,
  RoutePathSchema,
  RouteProviderResultSchema,
  RouteRequestSchema,
  RouteSignalSchema,
  type RoutePath,
  type RouteProfile,
  type RouteProviderResult,
  type RouteRequest,
  type RouteSignal,
} from "../../contracts";
import { z } from "zod";

const GraphHopperInstructionSchema = z.object({
  text: z.string().min(1),
  distance: z.number().nonnegative(),
  time: z.number().nonnegative(),
});

const GraphHopperRawPathSchema = z.object({
  distance: z.number().nonnegative(),
  time: z.number().nonnegative(),
  points: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.array(z.number()).min(2)).min(2),
  }),
  instructions: z.array(GraphHopperInstructionSchema).default([]),
});

const GraphHopperResponseSchema = z.object({ paths: z.array(GraphHopperRawPathSchema).min(1) });

const GraphHopperAreaSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.array(z.number()).length(2)).min(4)).min(1),
  }),
});

const GraphHopperPrioritySchema = z.object({
  if: z.string().min(1),
  multiply_by: z.literal("0"),
});

export const GraphHopperCustomModelSchema = z.object({
  areas: z.record(z.string().min(1), GraphHopperAreaSchema),
  priority: z.array(GraphHopperPrioritySchema),
});
export type GraphHopperCustomModel = z.infer<typeof GraphHopperCustomModelSchema>;

export type GraphHopperRouteInput = {
  request: RouteRequest;
  profile: RouteProfile;
  blockedSignals: RouteSignal[];
};

export type GraphHopperRouteProviderOptions = {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

function blockedSignal(signal: RouteSignal): boolean {
  return (
    signal.kind === "road_closure" ||
    (signal.kind === "flood_zone" && signal.severity === "blocked") ||
    (signal.kind === "station_disruption" && signal.status !== "delayed") ||
    (signal.kind === "low_lighting" && signal.severity === "blocked")
  );
}

function areaName(signal: RouteSignal): string {
  return `area_${signal.id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

export function createBlockedAreaCustomModel(signals: RouteSignal[]): GraphHopperCustomModel {
  const areas: Record<string, GraphHopperCustomModel["areas"][string]> = {};
  const priority: GraphHopperCustomModel["priority"] = [];
  for (const signal of signals.filter(blockedSignal)) {
    if (signal.kind === "bike_station") continue;
    const name = areaName(signal);
    const coordinates = signal.polygon.map((point) => [point.longitude, point.latitude]);
    areas[name] = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coordinates] },
    };
    priority.push({ if: `in_${name}`, multiply_by: "0" });
  }
  return GraphHopperCustomModelSchema.parse({ areas, priority });
}

function toRoutePath(profile: RouteProfile, index: number, rawPath: z.infer<typeof GraphHopperRawPathSchema>): RoutePath {
  const coordinates = rawPath.points.coordinates.map(([longitude, latitude]) =>
    CoordinateSchema.parse({ latitude, longitude }),
  );
  return RoutePathSchema.parse({
    id: `graphhopper-${profile}-${index + 1}`,
    profile,
    coordinates,
    distanceMeters: rawPath.distance,
    durationSeconds: Math.ceil(rawPath.time / 1000),
    stationIds: [],
    instructions: rawPath.instructions.map((instruction) => ({
      text: instruction.text,
      distanceMeters: instruction.distance,
      durationSeconds: instruction.time / 1000,
    })),
    provider: "graphhopper",
  });
}

export class GraphHopperRouteProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GraphHopperRouteProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.GRAPHHOPPER_BASE_URL ?? "https://graphhopper.com/api/1";
    this.apiKey = options.apiKey ?? process.env.GRAPHHOPPER_API_KEY;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async calculate(input: GraphHopperRouteInput): Promise<RouteProviderResult> {
    const request = RouteRequestSchema.parse(input.request);
    const signals = input.blockedSignals.map((signal) => RouteSignalSchema.parse(signal));
    const url = new URL("route", `${this.baseUrl.replace(/\/$/, "")}/`);
    url.searchParams.set("point", `${request.origin.coordinate.latitude},${request.origin.coordinate.longitude}`);
    url.searchParams.append(
      "point",
      `${request.destination.coordinate.latitude},${request.destination.coordinate.longitude}`,
    );
    url.searchParams.set("profile", input.profile);
    url.searchParams.set("points_encoded", "false");
    url.searchParams.set("instructions", "true");
    url.searchParams.set("algorithm", "alternative_route");
    url.searchParams.set("alternative_route.max_paths", "3");
    url.searchParams.set("alternative_route.max_weight_factor", "1.4");
    if (this.apiKey) url.searchParams.set("key", this.apiKey);
    if (signals.some(blockedSignal)) {
      url.searchParams.set("custom_model", JSON.stringify(createBlockedAreaCustomModel(signals)));
    }

    try {
      const response = await this.fetchImpl(url);
      if (!response.ok) {
        return RouteProviderResultSchema.parse({
          status: "unavailable",
          reason: `GraphHopper 回傳 ${response.status}`,
        });
      }
      const data = GraphHopperResponseSchema.parse(await response.json());
      return RouteProviderResultSchema.parse({
        status: "ok",
        paths: data.paths.map((path, index) => toRoutePath(input.profile, index, path)),
      });
    } catch (error) {
      return RouteProviderResultSchema.parse({
        status: "unavailable",
        reason: error instanceof Error ? error.message : "GraphHopper 服務無法使用",
      });
    }
  }
}
