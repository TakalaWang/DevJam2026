import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const pageSource = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");

describe("workbench independent scrolling layout", () => {
  it("keeps the desktop shell fixed while each region owns its scroll container", () => {
    expect(stylesheet).toMatch(
      /\.workbench\s*\{[\s\S]*?height:\s*100vh;[\s\S]*?overflow:\s*hidden;/,
    );
    expect(stylesheet).toMatch(
      /\.workbench-grid\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/,
    );
    expect(stylesheet).toMatch(
      /\.history-sidebar,\s*\.itinerary-panel\s*\{[\s\S]*?overflow-y:\s*auto;/,
    );
    expect(stylesheet).toMatch(/\.conversation-panel\s*\{[\s\S]*?overflow:\s*hidden;/);
    expect(stylesheet).toMatch(/\.conversation-log\s*\{[\s\S]*?overflow-y:\s*auto;/);
    expect(stylesheet).toMatch(/\.composer\s*\{[\s\S]*?flex:\s*0 0 auto;/);
  });

  it("does not render the accidental planning checklist panel", () => {
    expect(pageSource).not.toContain("planning-checklist");
    expect(stylesheet).not.toContain("planning-checklist");
  });

  it("hides the itinerary panel until a plan exists", () => {
    expect(pageSource).toContain('"without-itinerary"');
    expect(pageSource).toMatch(/\{itinerary && \(\s*<section className="itinerary-panel"/);
    expect(pageSource).not.toContain("右側會顯示完整行程");
  });

  it("keeps the itinerary panel free of redundant helper copy", () => {
    expect(pageSource).not.toContain("map-fallback-note");
    expect(pageSource).not.toContain("可以在開始行程後繼續討論並優化");
    expect(pageSource).toContain("<h2>行程總覽</h2>");
    expect(stylesheet).not.toContain(".conversation-note");
    expect(stylesheet).not.toContain(".map-fallback-note");
  });

  it("confirms a pending plan from the conversation", () => {
    expect(pageSource).toContain('className="confirmation-action"');
    expect(pageSource).toContain('sendMessage("確認，就這樣安排")');
    expect(pageSource).not.toContain('className="confirmation-action-mark"');
    expect(pageSource).not.toContain('appendMessage("user", "這個安排可以，請幫我開始導航');
  });

  it("renders assistant messages as Markdown while keeping user messages plain", () => {
    expect(pageSource).toContain('import ReactMarkdown from "react-markdown";');
    expect(pageSource).toContain("<ReactMarkdown>{message.content}</ReactMarkdown>");
    expect(pageSource).toContain("<p>{message.content}</p>");
  });

  it("keeps judge demo status out of the conversation log", () => {
    const demoStart = pageSource.indexOf("function stopJudgeDemo()");
    const demoEnd = pageSource.indexOf("const readyToStart", demoStart);
    const demoSource = pageSource.slice(demoStart, demoEnd);
    expect(demoSource).not.toContain("appendMessage");
    expect(demoSource).toContain("?source=judge-demo");
  });
});
