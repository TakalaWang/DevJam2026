import {
  ApiErrorResponseSchema,
  CreateTripRequestSchema,
  TripResponseSchema,
} from "../../../contracts";
import { tripOrchestrator } from "../../../lib/workflow/orchestrator";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(ApiErrorResponseSchema.parse({ error: "請求格式必須是 JSON" }), {
      status: 400,
    });
  }
  const parsed = CreateTripRequestSchema.safeParse(body);
  if (!parsed.success)
    return Response.json(ApiErrorResponseSchema.parse({ error: "建立旅程的資料格式錯誤" }), {
      status: 400,
    });
  const trip = tripOrchestrator.createTrip(parsed.data.userId);
  return Response.json(TripResponseSchema.parse({ trip }));
}
