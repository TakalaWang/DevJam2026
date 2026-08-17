import { AgentRunSchema, ApiErrorResponseSchema } from "../../../../contracts";
import { tripOrchestrator } from "../../../../lib/workflow/orchestrator";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const run = tripOrchestrator.getRun(id);
  if (!run)
    return Response.json(ApiErrorResponseSchema.parse({ error: "找不到執行紀錄" }), {
      status: 404,
    });
  return Response.json(AgentRunSchema.parse(run));
}
