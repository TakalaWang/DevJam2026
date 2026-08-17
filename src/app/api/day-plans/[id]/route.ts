import { ApiErrorResponseSchema, DayItineraryResponseSchema } from "../../../../contracts";
import {
  itineraryOrchestrator,
  type ItineraryOrchestrator,
} from "../../../../lib/itinerary/orchestrator";

export const runtime = "nodejs";

export function createGetHandler(orchestrator: ItineraryOrchestrator) {
  return async function GET(
    _request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id } = await context.params;
    const itinerary = orchestrator.getSession(id);
    if (!itinerary)
      return Response.json(ApiErrorResponseSchema.parse({ error: "找不到一天行程 session" }), {
        status: 404,
      });
    const lastRun = orchestrator.getLatestRun(id);
    return Response.json(
      DayItineraryResponseSchema.parse({
        itinerary,
        runs: orchestrator.getRuns(id),
        ...(lastRun ? { lastRun } : {}),
      }),
    );
  };
}

export const GET = createGetHandler(itineraryOrchestrator);
