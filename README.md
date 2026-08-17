# Routecraft · 台灣旅遊聊天助理

Routecraft 是一個以自然語言開始台灣旅遊規劃的聊天介面。這個版本先提供 Gemini 基礎多輪聊天，回覆透過 SSE 串流即時顯示；右側行程面板會在後續版本接上完整行程生成。

## 啟動

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

開啟 <http://localhost:3000>，並在 `.env.local` 設定 `GEMINI_API_KEY`。

對話狀態由 Gemini Interactions API 管理，前端保存 `interactionId` 並在下一輪傳回。重新整理頁面會開始新的對話。

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
