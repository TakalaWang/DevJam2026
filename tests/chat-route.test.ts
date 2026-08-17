import { beforeEach, describe, expect, it, vi } from "vitest";

const { createGeminiStream } = vi.hoisted(() => ({ createGeminiStream: vi.fn() }));

vi.mock("../src/lib/gemini", () => ({
  createGeminiStream,
  errorFrom: (event: { event_type: string; error?: { message?: string } }) =>
    event.event_type === "error" ? (event.error?.message ?? "Gemini 互動失敗") : undefined,
  interactionIdFrom: (event: {
    event_type: string;
    interaction?: { id: string };
    interaction_id?: string;
  }) =>
    event.event_type === "interaction.created" || event.event_type === "interaction.completed"
      ? event.interaction?.id
      : event.event_type === "interaction.status_update"
        ? event.interaction_id
        : undefined,
  textFrom: (event: { event_type: string; delta?: { type: string; text?: string } }) =>
    event.event_type === "step.delta" && event.delta?.type === "text"
      ? event.delta.text
      : undefined,
}));

import { POST } from "../src/app/api/chat/route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readResponse(response: Response) {
  return response.text();
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    createGeminiStream.mockReset();
  });

  it("rejects an empty message", async () => {
    const response = await POST(request({ message: " " }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "請輸入訊息" });
  });

  it("requires the Gemini API key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    const response = await POST(request({ message: "想去台南玩" }));

    expect(response.status).toBe(503);
  });

  it("streams text and returns the interaction id", async () => {
    createGeminiStream.mockResolvedValue(
      (async function* () {
        yield { event_type: "interaction.created", interaction: { id: "next-id" } };
        yield { event_type: "step.start", index: 0, step: { type: "model_output" } };
        yield { event_type: "step.delta", delta: { type: "thought_summary", summary: [] } };
        yield { event_type: "step.delta", delta: { type: "text", text: "你好" } };
        yield { event_type: "interaction.completed", interaction: { id: "next-id" } };
      })(),
    );

    const response = await POST(request({ message: "想去台南玩" }));
    const body = await readResponse(response);

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain('event: text\ndata: {"text":"你好"}');
    expect(body).toContain('event: done\ndata: {"interactionId":"next-id"}');
    expect(body).not.toContain("thought_summary");
  });

  it("passes the previous interaction id to Gemini", async () => {
    createGeminiStream.mockResolvedValue((async function* () {})());

    await POST(request({ message: "那明天呢？", interactionId: "previous-id" }));

    expect(createGeminiStream).toHaveBeenCalledWith("test-key", "那明天呢？", "previous-id");
  });
});
