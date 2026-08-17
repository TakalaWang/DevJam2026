import { describe, expect, it } from "vitest";
import { composerKeyAction, isComposingEnter } from "../src/lib/composer";

describe("chat composer keyboard behavior", () => {
  it("sends on Enter", () => {
    expect(composerKeyAction({ key: "Enter" })).toBe("send");
  });

  it("keeps Shift plus Enter available for a new line", () => {
    expect(composerKeyAction({ key: "Enter", shiftKey: true })).toBe("newline");
  });

  it("does not submit while an input method is composing", () => {
    expect(composerKeyAction({ key: "Enter", isComposing: true })).toBe("ignore");
  });

  it("does not submit while the composition state ref is active", () => {
    expect(composerKeyAction({ key: "Enter" }, true)).toBe("ignore");
  });

  it("does not submit for the browser IME keyCode", () => {
    expect(composerKeyAction({ key: "Enter", keyCode: 229 })).toBe("ignore");
  });

  it("recognizes the browser's IME keyCode while composition is active", () => {
    expect(isComposingEnter({ key: "Enter", keyCode: 229 })).toBe(true);
    expect(isComposingEnter({ key: "Enter" }, true)).toBe(true);
    expect(isComposingEnter({ key: "Enter" })).toBe(false);
  });

  it("ignores other keys", () => {
    expect(composerKeyAction({ key: "a" })).toBe("ignore");
  });
});
