import { ApiErrorResponseSchema, DayItineraryResponseSchema } from "../../../../../contracts";
import {
  itineraryOrchestrator,
  type ItineraryOrchestrator,
} from "../../../../../lib/itinerary/orchestrator";

export const runtime = "nodejs";

export function createCompleteHandler(orchestrator: ItineraryOrchestrator) {
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
    const runMessage =
      new URL(request.url).searchParams.get("source") === "judge-demo"
        ? "system:judge_demo:complete"
        : undefined;
    const result = await orchestrator.sendMessage(id, "完成行程", runMessage);
    return Response.json(DayItineraryResponseSchema.parse(result), {
      status: result.lastRun.status === "failed" ? 409 : 200,
    });
  };
}

export const POST = createCompleteHandler(itineraryOrchestrator);
