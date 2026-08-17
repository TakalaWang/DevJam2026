import {
  ApiErrorResponseSchema,
  CreateDayItineraryRequestSchema,
  DayItineraryResponseSchema,
  DayItineraryListResponseSchema,
  DayItinerarySummarySchema,
  ListDayItinerariesQuerySchema,
} from "../../../contracts";
import {
  itineraryOrchestrator,
  type ItineraryOrchestrator,
} from "../../../lib/itinerary/orchestrator";

export const runtime = "nodejs";

export function createGetHandler(orchestrator: ItineraryOrchestrator) {
  return async function GET(request: Request): Promise<Response> {
    const parsed = ListDayItinerariesQuerySchema.parse({
      userId: new URL(request.url).searchParams.get("userId") ?? undefined,
    });
    const itineraries = orchestrator.listSessions(parsed.userId).map((itinerary) =>
      DayItinerarySummarySchema.parse({
        id: itinerary.id,
        userId: itinerary.userId,
        status: itinerary.status,
        revision: itinerary.revision,
        date: itinerary.date,
        stopCount: itinerary.stops.length,
        updatedAt: itinerary.updatedAt,
      }),
    );
    return Response.json(DayItineraryListResponseSchema.parse({ itineraries }));
  };
}

function errorResponse(message: string, status: number): Response {
  return Response.json(ApiErrorResponseSchema.parse({ error: message }), { status });
}

export function createPostHandler(orchestrator: ItineraryOrchestrator) {
  return async function POST(request: Request): Promise<Response> {
    let body: object;
    try {
      body = await request.json();
    } catch {
      return errorResponse("請求格式必須是 JSON", 400);
    }
    const parsed = CreateDayItineraryRequestSchema.safeParse(body);
    if (!parsed.success) return errorResponse("建立一天行程的資料格式錯誤", 400);
    const itinerary = orchestrator.createSession(parsed.data.userId, parsed.data.date);
    return Response.json(DayItineraryResponseSchema.parse({ itinerary }));
  };
}

export const GET = createGetHandler(itineraryOrchestrator);
export const POST = createPostHandler(itineraryOrchestrator);
