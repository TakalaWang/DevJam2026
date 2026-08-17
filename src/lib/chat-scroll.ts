export function scrollChatLog(element: { scrollHeight: number; scrollTop: number }): void {
  element.scrollTop = element.scrollHeight;
}
