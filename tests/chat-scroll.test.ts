import { describe, expect, it } from "vitest";
import { scrollChatLog } from "../src/lib/chat-scroll";

describe("chat log scrolling", () => {
  it("moves the log to the newest content", () => {
    const log = { scrollHeight: 840, scrollTop: 12 };

    scrollChatLog(log);

    expect(log.scrollTop).toBe(840);
  });
});
