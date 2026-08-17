export type ComposerKeyAction = "send" | "newline" | "ignore";

export function isComposingEnter(
  event: { key: string; isComposing?: boolean; keyCode?: number },
  composing = false,
): boolean {
  return (
    event.key === "Enter" && (event.isComposing === true || composing || event.keyCode === 229)
  );
}

export function composerKeyAction(event: {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}, composing = false): ComposerKeyAction {
  if (event.key !== "Enter") return "ignore";
  if (event.isComposing || composing || event.keyCode === 229) return "ignore";
  return event.shiftKey ? "newline" : "send";
}
