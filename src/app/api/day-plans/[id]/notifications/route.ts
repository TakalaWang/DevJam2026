import { ApiErrorResponseSchema, NotificationListResponseSchema } from "../../../../../contracts";
import {
  itineraryOrchestrator,
  type ItineraryOrchestrator,
} from "../../../../../lib/itinerary/orchestrator";

export const runtime = "nodejs";

export function createNotificationsHandler(orchestrator: ItineraryOrchestrator) {
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
    return Response.json(
      NotificationListResponseSchema.parse({ notifications: itinerary.notifications }),
    );
  };
}

export const GET = createNotificationsHandler(itineraryOrchestrator);
