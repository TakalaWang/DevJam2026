import { createGeminiStream, errorFrom, interactionIdFrom, textFrom } from "../../../lib/gemini";
import {
  ApiErrorResponseSchema,
  ChatRequestSchema,
  ChatSseEventSchema,
  type ChatSseEvent,
} from "../../../contracts";

export const runtime = "nodejs";

function sse(event: ChatSseEvent["event"], data: ChatSseEvent["data"]): string {
  const parsed = ChatSseEventSchema.parse({ event, data });
  return `event: ${parsed.event}\ndata: ${JSON.stringify(parsed.data)}\n\n`;
}

function errorResponse(message: string, status: number): Response {
  return Response.json(ApiErrorResponseSchema.parse({ error: message }), { status });
}

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse("請求格式必須是 JSON", 400);
  }

  const parsedBody = ChatRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    const issue = parsedBody.error.issues[0];
    return errorResponse(issue?.message ?? "請求格式錯誤", issue?.code === "too_big" ? 413 : 400);
  }
  const body = parsedBody.data;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return errorResponse("尚未設定 GEMINI_API_KEY", 503);

  let upstream: Awaited<ReturnType<typeof createGeminiStream>>;
  try {
    upstream = await createGeminiStream(apiKey, body.message, body.interactionId);
  } catch {
    return errorResponse("Gemini 服務暫時無法使用", 502);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let latestInteractionId: string | undefined;

      try {
        for await (const event of upstream) {
          latestInteractionId = interactionIdFrom(event) ?? latestInteractionId;
          const text = textFrom(event);
          if (text) controller.enqueue(encoder.encode(sse("text", { text })));

          const error = errorFrom(event);
          if (error) {
            controller.enqueue(encoder.encode(sse("error", { error })));
            controller.close();
            return;
          }
        }

        if (latestInteractionId) {
          controller.enqueue(encoder.encode(sse("done", { interactionId: latestInteractionId })));
        }
        controller.close();
      } catch {
        controller.enqueue(encoder.encode(sse("error", { error: "Gemini 串流中斷" })));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
