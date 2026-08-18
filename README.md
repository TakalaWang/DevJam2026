# Routa 智旅

> 用對話建立一日行程，遇到城市事件時重新規劃路線。

Routa 是一個日行程 Web 工作台。使用者可以用自然語言描述目的地與交通偏好，確認後建立完整行程；行程開始後，系統可以處理淹水、封路、車站中斷與 YouBike 無車等事件，重新計算受影響路段並產生通知。

## 功能

- 用 Gemini 對話建立與調整一日行程
- 支援步行、單車、開車與大眾運輸
- 以 deterministic planner 決定路線與安全狀態
- 可在本機使用 deterministic route provider，免設定 Google Routes API
- 可選擇串接 Google Routes、TDX、中央氣象署與其他城市資料
- 以 SQLite 保存本機行程與路線更新

## 快速開始

需要 Node.js、pnpm 10+ 與 Gemini API key。

```bash
pnpm install
cp .env.example .env.local
```

在 `.env.local` 設定：

```dotenv
GEMINI_API_KEY=你的_gemini_api_key
ROUTECRAFT_DEMO_MODE=true
```

啟動開發伺服器：

```bash
pnpm dev
```

開啟 <http://localhost:3000>，選擇日期後描述想去的地方。確認行程後即可開始使用。

## 環境變數

`.env.example` 已包含完整範例。以下依用途列出所有可用設定：

### Gemini

- `GEMINI_API_KEY`：Gemini 對話與通知 Agent；使用 Web UI 建立行程時需要。
- `GEMINI_MODEL`：可選的模型覆寫，預設為 `gemini-3.6-flash`。

### 路線與地圖

- `ROUTECRAFT_DEMO_MODE`：`true` 使用 deterministic route provider；`false` 使用 Google Routes。
- `GOOGLE_MAPS_API_KEY`：伺服器端 Google Routes API key。使用 `ROUTECRAFT_DEMO_MODE=false` 時需要。
- `GOOGLE_ROUTES_BASE_URL`：Google Routes endpoint，預設為 `https://routes.googleapis.com/directions/v2:computeRoutes`。
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`：可選的瀏覽器端 Google Maps JavaScript API key。
- `GOOGLE_PLACES_API_KEY`：可選的 Google Places API key，用於補充大眾運輸月台、站牌與無障礙資訊。
- `GOOGLE_PLACES_BASE_URL`：Google Places endpoint，預設為 `https://places.googleapis.com/v1/places:searchText`。

### 城市資料

- `TDX_BASE_URL`：TDX API 位址，預設為 `https://tdx.transportdata.tw`。
- `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`：TDX 交通、路況、YouBike 與大眾運輸資料。
- `CWA_API_KEY`：中央氣象署天氣警特報。
- `NCDR_API_KEY`：可選的 NCDR 災害示警資料。
- `TAIPEI_METRO_API_KEY`、`TAIPEI_METRO_CROWDING_URL`：可選的臺北捷運擁擠度資料。

### 本機資料

- `ROUTECRAFT_DB_PATH`：SQLite 行程 snapshot 路徑，預設為 `.data/routecraft-local.sqlite`。

除 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` 外，API key 都只應放在伺服器端環境變數；不要把伺服器端金鑰暴露給瀏覽器。

## 如何開始使用

1. 選擇日期並建立行程計劃。
2. 用自然語言描述出發地、目的地、活動、時間與交通偏好。
3. 確認行程內容，等待系統建立完整交通路線。
4. 在今天的行程按「開始行程」，開始查看與更新路線。

API route 實作位於 [`src/app/api/`](./src/app/api/)。

## 開發

```bash
pnpm test
pnpm run lint
pnpm run format:check
pnpm run build
```

## License

本專案以 [MIT License](./LICENSE) 授權。
