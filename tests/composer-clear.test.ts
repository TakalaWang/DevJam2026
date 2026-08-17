import { describe, expect, it } from "vitest";
import { clearComposerInput } from "../src/lib/composer-clear";

describe("chat composer clearing", () => {
  it("clears the live input element immediately", () => {
    const input = { value: "我要吃淡水" };

    clearComposerInput(input);

    expect(input.value).toBe("");
  });
});
