import { z } from "zod";

export const ApiErrorResponseSchema = z.object({ error: z.string().min(1) });
