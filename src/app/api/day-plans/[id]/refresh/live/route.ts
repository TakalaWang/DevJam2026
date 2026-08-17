import {
  ApiErrorResponseSchema,
  LiveDayItineraryResponseSchema,
  LiveRefreshRequestSchema,
} from "../../../../../../contracts";
import {
  itineraryOrchestrator,
  type ItineraryOrchestrator,
} from "../../../../../../lib/itinerary/orchestrator";

export const runtime = "nodejs";

function errorResponse(message: string, status: number): Response {
  return Response.json(ApiErrorResponseSchema.parse({ error: message }), { status });
}

export function createLiveRefreshHandler(orchestrator: ItineraryOrchestrator) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id } = await context.params;
    if (!orchestrator.getSession(id)) return errorResponse("找不到一天行程 session", 404);
    let body: object = {};
    try {
      if (request.headers.get("content-length") !== "0") body = await request.json();
    } catch {
      return errorResponse("請求格式必須是 JSON", 400);
    }
    const parsed = LiveRefreshRequestSchema.safeParse(body);
    if (!parsed.success) return errorResponse("live city feed 請求格式錯誤", 400);
    try {
      const result = await orchestrator.refreshLive(id, parsed.data);
      return Response.json(LiveDayItineraryResponseSchema.parse(result), {
        status: result.lastRun.status === "failed" ? 503 : 200,
      });
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : "即時城市資料更新失敗", 409);
    }
  };
}

export const POST = createLiveRefreshHandler(itineraryOrchestrator);
