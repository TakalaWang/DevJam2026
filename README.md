# Routecraft · 避塞車行程 Agent

這是一個自然語言行程規劃介面：使用者在左側像聊天一樣描述一天的安排，Gemini 解析固定約會、彈性景點與交通偏好；後端再用 Google Routes API 的交通感知路線驗證，右側呈現可行的時間軸與地圖。

固定時間不可移動；沒有固定時間的景點可以依交通時間重排。每次重排都會在聊天回覆中說明原因。

## 啟動

```bash
npm install
npm run dev
```

- 前端：<http://localhost:5173>
- API server：<http://localhost:8787>

沒有設定 Key 時會進入 Demo mode，仍可用自然語言展示基本解析流程。正式模式請複製 `.env.example` 為 `.env`，填入 `GEMINI_API_KEY` 與 `GOOGLE_MAPS_API_KEY`。

## 驗證

```bash
npm test
npm run build
```

Gemini 與 Google API Key 只由 Express server 讀取，不會送到瀏覽器。
