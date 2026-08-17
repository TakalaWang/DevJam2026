import { FunctionTool } from "@google/adk";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  PlaceToolInputSchema,
  PlaceToolOutputSchema,
  RouteToolInputSchema,
  RouteToolOutputSchema,
  type PlaceToolInput,
  type RouteToolInput,
} from "../../contracts";

const RoutesResponseSchema = z.object({
  routes: z
    .array(
      z.object({
        duration: z.string(),
        staticDuration: z.string().optional(),
        distanceMeters: z.number(),
      }),
    )
    .min(1),
});

const PlacesResponseSchema = z.object({
  places: z
    .array(
      z.object({
        displayName: z.object({ text: z.string() }),
        formattedAddress: z.string(),
        googleMapsUri: z.string().url().optional(),
        regularOpeningHours: z.object({ weekdayDescriptions: z.array(z.string()) }).optional(),
      }),
    )
    .min(1),
});

function durationSeconds(value: string): number {
  const seconds = Number(value.replace(/s$/, ""));
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Google API 回傳無效的交通時間");
  return Math.round(seconds);
}

export async function runRoute(input: RouteToolInput) {
  input = RouteToolInputSchema.parse(input);
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey)
    return RouteToolOutputSchema.parse({
      status: "unavailable",
      reason: "尚未設定 GOOGLE_MAPS_API_KEY",
    });

  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
    },
    body: JSON.stringify({
      origin: { address: input.origin },
      destination: { address: input.destination },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      ...(input.departureAt ? { departureTime: input.departureAt } : {}),
    }),
  });
  if (!response.ok)
    return RouteToolOutputSchema.parse({
      status: "unavailable",
      reason: `Routes API 回傳 ${response.status}`,
    });

  const data = RoutesResponseSchema.parse(await response.json());
  const route = data.routes[0];
  return RouteToolOutputSchema.parse({
    status: "ok",
    origin: input.origin,
    destination: input.destination,
    trafficSeconds: durationSeconds(route.duration),
    normalSeconds: durationSeconds(route.staticDuration ?? route.duration),
    distanceMeters: route.distanceMeters,
    evidence: {
      id: `route-${randomUUID()}`,
      kind: "route",
      source: "Google Routes API",
      fetchedAt: new Date().toISOString(),
      summary: `Google Routes: ${input.origin} → ${input.destination}`,
      origin: input.origin,
      destination: input.destination,
      trafficSeconds: durationSeconds(route.duration),
      normalSeconds: durationSeconds(route.staticDuration ?? route.duration),
      distanceMeters: route.distanceMeters,
    },
  });
}

export async function runPlace(input: PlaceToolInput) {
  input = PlaceToolInputSchema.parse(input);
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey)
    return PlaceToolOutputSchema.parse({
      status: "unavailable",
      reason: "尚未設定 GOOGLE_MAPS_API_KEY",
    });

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.googleMapsUri,places.regularOpeningHours",
    },
    body: JSON.stringify({ textQuery: input.query, languageCode: "zh-TW" }),
  });
  if (!response.ok)
    return PlaceToolOutputSchema.parse({
      status: "unavailable",
      reason: `Places API 回傳 ${response.status}`,
    });

  const data = PlacesResponseSchema.parse(await response.json());
  const place = data.places[0];
  return PlaceToolOutputSchema.parse({
    status: "ok",
    name: place.displayName.text,
    address: place.formattedAddress,
    ...(place.googleMapsUri ? { mapsUrl: place.googleMapsUri } : {}),
    openingHours: place.regularOpeningHours?.weekdayDescriptions ?? null,
    evidence: {
      id: `place-${randomUUID()}`,
      kind: "place",
      source: "Google Places API",
      fetchedAt: new Date().toISOString(),
      summary: `Google Places: ${place.displayName.text}`,
      name: place.displayName.text,
      address: place.formattedAddress,
      ...(place.googleMapsUri ? { mapsUrl: place.googleMapsUri } : {}),
      openingHours: place.regularOpeningHours?.weekdayDescriptions ?? null,
    },
  });
}

export function createRouteTool(): FunctionTool<typeof RouteToolInputSchema> {
  return new FunctionTool({
    name: "get_route",
    description: "取得兩個地點之間的交通時間與距離。",
    parameters: RouteToolInputSchema,
    execute: runRoute,
  });
}

export function createPlaceTool(): FunctionTool<typeof PlaceToolInputSchema> {
  return new FunctionTool({
    name: "get_place_details",
    description: "查詢地點地址與營業時間。",
    parameters: PlaceToolInputSchema,
    execute: runPlace,
  });
}
