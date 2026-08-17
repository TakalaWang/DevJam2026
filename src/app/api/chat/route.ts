import { createGeminiStream, errorFrom, interactionIdFrom, textFrom } from "../../../lib/gemini";

export const runtime = "nodejs";

const MAX_MESSAGE_LENGTH = 4_000;

type ChatRequest = { message?: unknown; interactionId?: unknown };

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return errorResponse("請求格式必須是 JSON", 400);
  }

  if (typeof body.message !== "string" || !body.message.trim()) {
    return errorResponse("請輸入訊息", 400);
  }
  if (body.message.length > MAX_MESSAGE_LENGTH) {
    return errorResponse(`訊息不可超過 ${MAX_MESSAGE_LENGTH} 個字元`, 413);
  }
  if (body.interactionId !== undefined && typeof body.interactionId !== "string") {
    return errorResponse("interactionId 格式錯誤", 400);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return errorResponse("尚未設定 GEMINI_API_KEY", 503);

  let upstream: Awaited<ReturnType<typeof createGeminiStream>>;
  try {
    upstream = await createGeminiStream(
      apiKey,
      body.message.trim(),
      body.interactionId as string | undefined,
    );
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
