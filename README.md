# 智慧避塞車行程 Agent

輸入一天的固定行程，程式會逐段查詢開車路線並顯示交通感知行車時間、延誤與最晚出發時間。Google Maps Routes API 算路徑與路況；這個應用程式不讓 LLM 猜道路或塞車狀況。

## 啟動

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
PYTHONPATH=src .venv/bin/streamlit run app.py
```

未設定金鑰時，頁面會進入明確標示的 **Demo mode**，使用固定資料，方便黑客松展示。

## 使用即時 Google 路況

1. 在 Google Cloud 專案啟用 **Routes API**，並設定 billing。
2. 複製 `.env.example` 為 `.env`，填入 `GOOGLE_MAPS_API_KEY`。
3. 重新啟動 Streamlit。

金鑰只由 Streamlit 伺服器讀取，不會出現在瀏覽器端。Google 的交通資料僅適用於未來的出發時間；若輸入已過去的時間，請改成今天稍後或未來日期。
