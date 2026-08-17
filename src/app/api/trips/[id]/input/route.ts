import {
  ApiErrorResponseSchema,
  TripInputSchema,
  TripResponseSchema,
} from "../../../../../contracts";
import { tripOrchestrator } from "../../../../../lib/workflow/orchestrator";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(ApiErrorResponseSchema.parse({ error: "請求格式必須是 JSON" }), {
      status: 400,
    });
  }
  const parsed = TripInputSchema.safeParse(body);
  if (!parsed.success)
    return Response.json(ApiErrorResponseSchema.parse({ error: "旅程輸入格式錯誤" }), {
      status: 400,
    });

  try {
    const { snapshot, run } = await tripOrchestrator.process(id, parsed.data);
    return Response.json(TripResponseSchema.parse({ trip: snapshot, lastRun: run }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "工作流執行失敗";
    return Response.json(ApiErrorResponseSchema.parse({ error: message }), {
      status: message === "找不到旅程" ? 404 : 422,
    });
  }
}
