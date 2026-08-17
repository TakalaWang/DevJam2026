"use client";

import { FormEvent, useRef, useState } from "react";
import { readSseStream } from "../lib/sse";

type ChatMessage = { id: number; role: "user" | "assistant"; content: string };

const starter: ChatMessage = {
  id: 0,
  role: "assistant",
  content:
    "告訴我今天想去哪裡、哪些事情有固定時間，以及你想怎麼移動。自然說就好，例如：\n\n「下午兩點到 101 開會，傍晚去內湖吃飯，途中想去大稻埕買茶。」",
};

export default function Page() {
  const [messages, setMessages] = useState<ChatMessage[]>([starter]);
  const [draft, setDraft] = useState("");
  const [interactionId, setInteractionId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const nextMessageId = useRef(1);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || loading) return;

    const userMessage: ChatMessage = { id: nextMessageId.current++, role: "user", content };
    const assistantId = nextMessageId.current++;
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setDraft("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, interactionId }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "暫時無法連線");
      }
      if (!response.body) throw new Error("聊天串流沒有回應內容");

      await readSseStream(response.body, (event) => {
        const data = JSON.parse(event.data) as {
          text?: string;
          interactionId?: string;
          error?: string;
        };

        if (event.event === "text" && data.text) {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + data.text }
                : message,
            ),
          );
        }
        if (event.event === "done" && data.interactionId) setInteractionId(data.interactionId);
        if (event.event === "error") throw new Error(data.error ?? "Gemini 服務暫時無法使用");
      });
    } catch (requestError) {
      setMessages((current) => current.filter((message) => message.id !== assistantId));
      setError(requestError instanceof Error ? requestError.message : "暫時無法連線");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <span>ROUTECRAFT</span>
          <small>台灣旅遊規劃 Agent</small>
        </div>
        <div className="mode-pill live">
          <i />
          GEMINI INTERACTIVE
        </div>
      </header>

      <section className="workspace">
        <aside className="chat-panel">
          <div className="panel-intro">
            <p className="eyebrow">01 / CONVERSATION</p>
            <h1>
              把今天交給
              <br />
              <em>路線感知。</em>
            </h1>
            <p className="subcopy">先說出你的想法，我會陪你一步一步整理出適合台灣旅程的方向。</p>
          </div>

          <div className="chat-log" aria-live="polite">
            {messages.map((message) => (
              <div className={`message ${message.role}`} key={message.id}>
                <span className="message-label">
                  {message.role === "assistant" ? "ROUTECRAFT" : "YOU"}
                </span>
                <p>{message.content}</p>
              </div>
            ))}
            {loading && (
              <div className="message assistant loading">
                <span className="message-label">ROUTECRAFT</span>
                <p>
                  <span className="pulse" />
                  正在思考你的旅程…
                </p>
              </div>
            )}
          </div>

          <form className="chat-composer" onSubmit={sendMessage}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="像聊天一樣描述你的旅程…"
              rows={3}
              aria-label="輸入訊息"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage(event);
                }
              }}
            />
            <div className="composer-footer">
              <span>Enter 傳送 · Shift + Enter 換行</span>
              <button type="submit" aria-label="傳送" disabled={loading}>
                ↗
              </button>
            </div>
          </form>
          {error && <p className="error-text">{error}</p>}
        </aside>

        <section className="plan-panel">
          <div className="plan-header">
            <div>
              <p className="eyebrow">02 / LIVING ITINERARY</p>
              <h2>你的行程會出現在這裡</h2>
            </div>
            <span className="route-count">待命中</span>
          </div>
          <div className="empty-plan">
            <div className="empty-orbit">⌁</div>
            <p>先聊聊你的旅程。</p>
            <span>當對話整理完成後，這裡會長出完整的時間軸與路線。</span>
          </div>
        </section>
      </section>
    </main>
  );
}
