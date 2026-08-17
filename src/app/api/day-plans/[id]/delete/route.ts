import { ApiErrorResponseSchema, DeleteDayItineraryResponseSchema } from "../../../../../contracts";
import {
  itineraryOrchestrator,
  type ItineraryOrchestrator,
} from "../../../../../lib/itinerary/orchestrator";

export const runtime = "nodejs";

export function createDeleteHandler(orchestrator: ItineraryOrchestrator) {
  return async function DELETE(
    _request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id } = await context.params;
    if (!orchestrator.deleteSession(id)) {
      return Response.json(ApiErrorResponseSchema.parse({ error: "找不到一天行程 session" }), {
        status: 404,
      });
    }
    return Response.json(DeleteDayItineraryResponseSchema.parse({ id, deleted: true }));
  };
}

export const DELETE = createDeleteHandler(itineraryOrchestrator);
