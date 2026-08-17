import { ApiErrorResponseSchema, TripResponseSchema } from "../../../../contracts";
import { tripOrchestrator } from "../../../../lib/workflow/orchestrator";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const trip = tripOrchestrator.getTrip(id);
  if (!trip)
    return Response.json(ApiErrorResponseSchema.parse({ error: "找不到旅程" }), { status: 404 });
  const lastRun = tripOrchestrator.getLatestRun(id);
  return Response.json(TripResponseSchema.parse({ trip, ...(lastRun ? { lastRun } : {}) }));
}
