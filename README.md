# Routa 智旅 · 即時城市路線 App

Routa 智旅是只在本機執行的日行程 Web 工作台：左側保存行程紀錄，中間用 Gemini 討論，右側顯示從出門到回家的完整行程與每一段交通。開始行程後，可以送出淹水、封路、車站中斷與 YouBike 供給等 typed Demo 事件，重新計算受影響路段並產生通知。

城市事件有 `/demo`、`/refresh` 與 `/refresh/live` 三個入口；local client 或 cron 可呼叫 live endpoint，背景輪詢本身不由 Next process 常駐執行。

## 本機啟動

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

開啟 <http://localhost:3000>。目前實際程式使用的主要設定如下：

- `GEMINI_API_KEY`：Gemini Interactions API 對話與通知 Agent；手動操作建立行程需要設定。
- `GEMINI_MODEL`：模型覆寫，預設 `gemini-3.6-flash`。
- `GOOGLE_MAPS_API_KEY`：production mode 的伺服器端 Google Routes API key；`ROUTECRAFT_DEMO_MODE=true` 時不需要。
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`：可選的瀏覽器端 Google Maps JavaScript API key；未設定時 UI 使用內建 SVG 示意圖，不影響路線 API。
- `GOOGLE_ROUTES_BASE_URL`：Google Routes endpoint，預設 `https://routes.googleapis.com/directions/v2:computeRoutes`。
- `GOOGLE_PLACES_API_KEY`／`GOOGLE_PLACES_BASE_URL`：可選的 Google Places transit station lookup；用來補月台、方向牌、站牌代碼與無障礙入口資訊。
- `TDX_CLIENT_ID`／`TDX_CLIENT_SECRET`：TDX 交通、路況、YouBike、捷運／公車／臺鐵／高鐵異動。
- `CWA_API_KEY`：中央氣象署天氣警特報。
- `NCDR_API_KEY`：可選的 NCDR 災害示警 API；未設定時不啟用替代災防來源。
- `TAIPEI_METRO_API_KEY`／`TAIPEI_METRO_CROWDING_URL`：可選的臺北捷運擁擠度會員 API；未設定時仍使用 TDX 捷運服務異動。
- `ROUTECRAFT_DB_PATH`：SQLite snapshot 路徑，預設 `.data/routecraft-local.sqlite`。

### `ROUTECRAFT_DEMO_MODE`

在 `.env` 或 `.env.local` 設定模式，修改後重新啟動 `pnpm dev`：

```dotenv
ROUTECRAFT_DEMO_MODE=true
```

- `true`：使用 `DemoRouteProvider`。路線以 deterministic 的直達／繞道路徑計算，Demo 事件不呼叫 Google Routes API，因此不需要 `GOOGLE_MAPS_API_KEY`。
- `false` 或其他值：使用 `GoogleRoutesProvider`，需要 `GOOGLE_MAPS_API_KEY` 才能建立與更新路線。

這個設定只控制路線 provider；手動對話與通知 Agent 仍需要 `GEMINI_API_KEY`。`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` 也仍只是瀏覽器地圖的可選金鑰，未設定時 UI 會顯示內建 SVG 示意圖。Demo mode 的四種事件都由 deterministic provider 產生可驗證的路線更新，測試涵蓋 `flood`、`road_closure`、`station_disruption` 與 `bike_unavailable`。

## 完整操作流程（Web UI）

1. 在日期欄選擇今天，按「建立行程計劃」。後端會建立 `discussing` 的本機 session。
2. 在中間對話框描述出發地、目的地、固定活動、交通偏好，以及是否回到起點。例如：

   ```text
   我今天從台北車站出發，下午想去台北小巨蛋聽演唱會，晚上回到台北車站，請安排開車行程。
   ```

   若 Agent 追問資料，補充後繼續送出；直到右側顯示完整交通段、狀態變成「可以出發」為止。production mode 若有路段顯示「路段受阻」，先確認 `GOOGLE_MAPS_API_KEY` 或修正行程；Demo mode 則先確認 `ROUTECRAFT_DEMO_MODE=true` 並已重啟 server。

3. 在今天的行程上按「開始今日行程」。後端只允許 `ready`、沒有 blocked leg 且日期等於今天的 session 開始，成功後狀態變成「執行中」。
4. 在「Demo 事件」下拉選擇一個情境，按「模擬更新並通知」：

   - `flood`：示範淹水區，禁止受影響路段通行。
   - `road_closure`：示範道路封閉，重新找替代路線。
   - `station_disruption`：示範車站中斷，改評估交通工具與路段。
   - `bike_unavailable`：示範 YouBike 起點無車。

   Demo 事件會經過同一個 deterministic route planner；Demo mode 會產生直達／繞道路線，右側上方會顯示城市狀況通知，說明原因、原方案、新方案與取捨。production mode 會改由 Google Routes 產生候選路線；若事件沒有造成 leg 變更，API 只保存 signal，不新增 route-change notification。

5. 可重複選擇不同事件觀察更新後的路線與通知；需要查看完整 typed `before`／`after`／`delta` 時，使用下方 notifications API。
6. 按「完成今日行程」。後端會把狀態改為 `completed`、已完成 stop 標記為 `visited`，UI 顯示「行程已完成」。

## 一日行程 API 操作

以下指令可直接走完與 Web UI 相同的流程。先啟動 `pnpm dev`，再建立今天的 session：

```bash
BASE=http://localhost:3000
DATE=$(date +%F)

curl -sS -X POST "$BASE/api/day-plans" \
  -H 'Content-Type: application/json' \
  -d "{\"userId\":\"local-demo-user\",\"date\":\"$DATE\"}"
```

從 response 的 `itinerary.id` 設定 `PLAN_ID`，再用自然語言建立行程。Gemini 可能要求補充資料，重複呼叫此 endpoint 直到 `itinerary.status` 為 `ready`：

```bash
PLAN_ID=<從上一個 response 複製 itinerary.id>

curl -sS -X POST "$BASE/api/day-plans/$PLAN_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"message":"我今天從台北車站出發，下午去台北小巨蛋聽演唱會，晚上回到台北車站，請安排開車行程。"}'
```

開始、選擇四種 Demo 事件、查看通知，再完成行程：

```bash
curl -sS -X POST "$BASE/api/day-plans/$PLAN_ID/start"

# scenario 依序可替換為 flood、road_closure、station_disruption、bike_unavailable
curl -sS -X POST "$BASE/api/day-plans/$PLAN_ID/demo" \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"flood"}'

curl -sS "$BASE/api/day-plans/$PLAN_ID/notifications"

curl -sS -X POST "$BASE/api/day-plans/$PLAN_ID/complete"
```

其他 API：

```http
GET /api/day-plans?userId=local-demo-user
GET /api/day-plans/:id
POST /api/day-plans/:id/refresh        { "signals": [] }
POST /api/day-plans/:id/refresh/live   { "city": "Taipei" }
DELETE /api/day-plans/:id/delete
```

`/refresh/live` 會查詢已設定的 TDX 與 CWA，並將 NCDR／臺北捷運擁擠 API 視為可選 feed。未設定或暫時失效的 feed 會保留 typed `unavailable`，不會把缺資料當成「目前正常」。

所有 API、Agent、Google Routes mapper、SQLite snapshot、run、route signal 與 notification 都先經 Zod schema 驗證。Gemini 只能提出 typed itinerary command；路線與安全裁決由 deterministic route planner 處理。

## API／e2e 驗證指令

API 流程測試會自行注入 fixture Agent 與 fixture route provider，因此不需要 Gemini 或 Google key：

```bash
# API route handler 的建立 → 對話 → 開始 → Demo → notifications → 完成流程
pnpm exec vitest run tests/day-itinerary-api.test.ts

# itinerary orchestrator 的完整日行程與事件通知流程
pnpm exec vitest run tests/day-itinerary.test.ts

# 全部測試、lint、production build
pnpm test
pnpm run lint
pnpm run build
```

目前 repository 沒有獨立的 Playwright e2e script；`tests/day-itinerary-api.test.ts` 是現有的 API-level e2e coverage。Google Routes mapper、waypoint detour、TDX／CWA gateway、可選 feed 的 unavailable 行為，以及行程歷史刪除另有獨立測試。
