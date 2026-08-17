import { describe, expect, it } from "vitest";
import { readSseStream } from "../src/lib/sse";

describe("readSseStream", () => {
  it("parses events split across chunks", async () => {
    const chunks = [
      new TextEncoder().encode('event: text\ndata: {"text":"你好"}\n'),
      new TextEncoder().encode('\nevent: done\ndata: {"interactionId":"abc"}\n\n'),
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const events: Array<{ event: string; data: string }> = [];

    await readSseStream(stream, (event) => events.push(event));

    expect(events).toEqual([
      { event: "text", data: '{"text":"你好"}' },
      { event: "done", data: '{"interactionId":"abc"}' },
    ]);
  });
});
