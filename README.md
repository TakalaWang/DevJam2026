# Routecraft · 台灣旅遊聊天助理

Routecraft 是一個以自然語言開始台灣旅遊規劃的聊天介面。後端現在提供 Google ADK＋Zod 的 typed multi-agent workflow；既有聊天回覆仍透過 SSE 串流，前端可逐步接上 Trip API。

## 啟動

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

開啟 <http://localhost:3000>，並在 `.env.local` 設定 `GEMINI_API_KEY`。

一般聊天狀態由 Gemini Interactions API 管理，前端保存 `interactionId` 並在下一輪傳回。多 Agent 行程狀態則由 SQLite snapshot 管理，並透過 Trip API 查詢。

## 驗證

```bash
pnpm test
pnpm run lint
pnpm run format:check
pnpm run build
```

## SSE API

```http
POST /api/chat
Content-Type: application/json
```

```json
{
  "message": "我想安排台南兩天一夜",
  "interactionId": "optional-previous-interaction-id"
}
```

回應為 `text/event-stream`，事件包含：

- `text`：Gemini 回覆的文字片段
- `done`：本輪新的 `interactionId`
- `error`：串流中途發生的錯誤

## Typed Trip API

建立旅程：

```http
POST /api/trips
Content-Type: application/json
```

```json
{ "userId": "anonymous" }
```

推進流程：

```http
POST /api/trips/:id/input
Content-Type: application/json
```

```json
{ "type": "message", "message": "我想安排大阪兩天一夜" }
```

也支援 `confirm_flight`、`confirm_lodging`、`accept_activity`、`reject_activity` 與 `confirm_plan` typed commands。查詢旅程使用 `GET /api/trips/:id`，查詢 Agent run 使用 `GET /api/runs/:id`。

除使用者可見的自然語言 `message` 外，Agent、tool、validator、workflow、SQLite 與 API payload 都會先經過 Zod 驗證。

有完整 Google API credentials 時，可用 `ROUTECRAFT_REAL_SMOKE=1 pnpm test tests/real-smoke.test.ts` 執行 Gemini、Google Search、Routes 與 Places smoke test；ADK devtools 已加入依賴供 trace/debug 使用。
