import {
  ApiErrorResponseSchema,
  DayItineraryResponseSchema,
  RefreshRequestSchema,
} from "../../../../../contracts";
import {
  itineraryOrchestrator,
  type ItineraryOrchestrator,
} from "../../../../../lib/itinerary/orchestrator";

export const runtime = "nodejs";

function errorResponse(message: string, status: number): Response {
  return Response.json(ApiErrorResponseSchema.parse({ error: message }), { status });
}

export function createRefreshHandler(orchestrator: ItineraryOrchestrator) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id } = await context.params;
    if (!orchestrator.getSession(id)) return errorResponse("找不到一天行程 session", 404);
    let body: object;
    try {
      body = await request.json();
    } catch {
      return errorResponse("請求格式必須是 JSON", 400);
    }
    const parsed = RefreshRequestSchema.safeParse(body);
    if (!parsed.success) return errorResponse("城市狀態格式錯誤", 400);
    const result = await orchestrator.refresh(id, parsed.data.signals);
    return Response.json(DayItineraryResponseSchema.parse(result), {
      status: result.lastRun.status === "failed" ? 503 : 200,
    });
  };
}

export const POST = createRefreshHandler(itineraryOrchestrator);
