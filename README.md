# Routa 智旅 · 即時城市路線 App

Routa 智旅是只在本機執行的日行程 Web 工作台：左側保存行程紀錄，中間用 Gemini 討論，右側顯示從出門到回家的完整行程與每一段交通。開始行程後，Demo monitor 可以模擬淹水、封路、車站中斷與 YouBike 供給事件，透過 GraphHopper 重新計算受影響路段並發送通知。

## 啟動

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

開啟 <http://localhost:3000>，在 `.env.local` 設定：

- `GEMINI_API_KEY`：Gemini Interactions API 對話與通知 Agent。
- `GEMINI_MODEL`：預設 `gemini-3.6-flash`。
- `GRAPHHOPPER_API_KEY`：GraphHopper 路線服務。
- `GRAPHHOPPER_BASE_URL`：預設 `https://graphhopper.com/api/1`。
- `ROUTECRAFT_DB_PATH`：SQLite snapshot 路徑。

## 一日行程 API

建立指定日期的一日 session：

```http
GET /api/day-plans?userId=local-demo-user
```

```http
POST /api/day-plans
Content-Type: application/json
```

```json
{ "userId": "local-demo-user", "date": "2026-08-17" }
```

用自然語言建立或修改行程，只有這個入口能改變 stops：

```http
POST /api/day-plans/:id/messages
Content-Type: application/json
```

```json
{ "message": "我今天想去聽演唱會，幫我把白天行程排好" }
```

開始當日執行：

```http
POST /api/day-plans/:id/start
```

完成當日行程：

```http
POST /api/day-plans/:id/complete
```

本地 Demo 事件：

```http
POST /api/day-plans/:id/demo
Content-Type: application/json
```

```json
{ "scenario": "flood" }
```

`scenario` 可為 `flood`、`road_closure`、`station_disruption` 或 `bike_unavailable`。刪除本機行程：

```http
DELETE /api/day-plans/:id/delete
```

送入 typed city signal 以重算受影響路段並產生通知。這也是 polling、webhook 或 cron 未來共用的入口：

```http
POST /api/day-plans/:id/refresh
Content-Type: application/json
```

```json
{ "signals": [] }
```

所有 API、Agent、GraphHopper mapper、SQLite snapshot、run、route signal 與 notification 都先經 Zod schema 驗證。Gemini 只能提出 typed itinerary command；路線與安全裁決由 deterministic route planner 處理。

## 驗證

```bash
pnpm test
pnpm run lint
pnpm run build
```

測試包含 GraphHopper route fixture、完整回家路段、行程歷史刪除，以及「指定日期 → Gemini 對話 → ready → 開始 → Demo 城市事件 → 通知 → 完成」的一日行程 e2e。
