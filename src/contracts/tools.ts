import { z } from "zod";
import { EvidenceSchema } from "./trip";

export const RouteToolInputSchema = z.object({
  origin: z.string().min(1),
  destination: z.string().min(1),
  departureAt: z.string().min(1).optional(),
});
export type RouteToolInput = z.infer<typeof RouteToolInputSchema>;

export const RouteToolOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    origin: z.string().min(1),
    destination: z.string().min(1),
    trafficSeconds: z.number().nonnegative(),
    normalSeconds: z.number().nonnegative(),
    distanceMeters: z.number().nonnegative(),
    evidence: EvidenceSchema.extend({
      kind: z.literal("route"),
      origin: z.string().min(1),
      destination: z.string().min(1),
      trafficSeconds: z.number().nonnegative(),
      normalSeconds: z.number().nonnegative(),
      distanceMeters: z.number().nonnegative(),
    }),
  }),
  z.object({ status: z.literal("unavailable"), reason: z.string().min(1) }),
]);
export type RouteToolOutput = z.infer<typeof RouteToolOutputSchema>;

export const PlaceToolInputSchema = z.object({ query: z.string().min(1) });
export type PlaceToolInput = z.infer<typeof PlaceToolInputSchema>;

export const PlaceToolOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    name: z.string().min(1),
    address: z.string().min(1),
    mapsUrl: z.string().url().optional(),
    openingHours: z.array(z.string()).nullable(),
    evidence: EvidenceSchema.extend({
      kind: z.literal("place"),
      name: z.string().min(1),
      address: z.string().min(1),
      mapsUrl: z.string().url().optional(),
      openingHours: z.array(z.string()).nullable(),
    }),
  }),
  z.object({ status: z.literal("unavailable"), reason: z.string().min(1) }),
]);
export type PlaceToolOutput = z.infer<typeof PlaceToolOutputSchema>;

export const GoogleSearchGroundingMetadataSchema = z.object({
  groundingChunks: z
    .array(
      z.object({
        web: z
          .object({
            uri: z.string().url(),
            title: z.string().min(1).optional(),
          })
          .optional(),
      }),
    )
    .default([]),
  webSearchQueries: z.array(z.string().min(1)).default([]),
});
export type GoogleSearchGroundingMetadata = z.infer<typeof GoogleSearchGroundingMetadataSchema>;
