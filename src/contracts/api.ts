import { z } from "zod";

export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1, "請輸入訊息").max(4_000, "訊息不可超過 4,000 個字元"),
  interactionId: z.string().min(1).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ApiErrorResponseSchema = z.object({ error: z.string().min(1) });
export const ChatTextEventSchema = z.object({ text: z.string() });
export const ChatDoneEventSchema = z.object({ interactionId: z.string().min(1) });
export const ChatErrorEventSchema = z.object({ error: z.string().min(1) });
export const ChatSseEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("text"), data: ChatTextEventSchema }),
  z.object({ event: z.literal("done"), data: ChatDoneEventSchema }),
  z.object({ event: z.literal("error"), data: ChatErrorEventSchema }),
]);
export type ChatSseEvent = z.infer<typeof ChatSseEventSchema>;
