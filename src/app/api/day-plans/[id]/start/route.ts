import { ApiErrorResponseSchema, DayItineraryResponseSchema } from "../../../../../contracts";
import {
  itineraryOrchestrator,
  type ItineraryOrchestrator,
} from "../../../../../lib/itinerary/orchestrator";

export const runtime = "nodejs";

export function createStartHandler(orchestrator: ItineraryOrchestrator) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id } = await context.params;
    if (!orchestrator.getSession(id))
      return Response.json(ApiErrorResponseSchema.parse({ error: "找不到一天行程 session" }), {
        status: 404,
      });
    const runMessage =
      new URL(request.url).searchParams.get("source") === "judge-demo"
        ? "system:judge_demo:start"
        : undefined;
    const result = await orchestrator.startNavigation(id, runMessage);
    return Response.json(DayItineraryResponseSchema.parse(result), {
      status: result.lastRun.status === "failed" ? 503 : 200,
    });
  };
}

export const POST = createStartHandler(itineraryOrchestrator);
