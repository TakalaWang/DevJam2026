import {
  ApiErrorResponseSchema,
  DayItineraryResponseSchema,
  DemoRefreshRequestSchema,
} from "../../../../../contracts";
import {
  itineraryOrchestrator,
  type ItineraryOrchestrator,
} from "../../../../../lib/itinerary/orchestrator";

export const runtime = "nodejs";

export function createDemoHandler(orchestrator: ItineraryOrchestrator) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id } = await context.params;
    if (!orchestrator.getSession(id)) {
      return Response.json(ApiErrorResponseSchema.parse({ error: "找不到一天行程 session" }), {
        status: 404,
      });
    }
    let body: object;
    try {
      body = await request.json();
    } catch {
      return Response.json(ApiErrorResponseSchema.parse({ error: "請求格式必須是 JSON" }), {
        status: 400,
      });
    }
    const parsed = DemoRefreshRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(ApiErrorResponseSchema.parse({ error: "Demo 事件格式錯誤" }), {
        status: 400,
      });
    }
    const result = await orchestrator.demoRefresh(id, parsed.data.scenario);
    return Response.json(DayItineraryResponseSchema.parse(result), {
      status: result.lastRun.status === "failed" ? 409 : 200,
    });
  };
}

export const POST = createDemoHandler(itineraryOrchestrator);
