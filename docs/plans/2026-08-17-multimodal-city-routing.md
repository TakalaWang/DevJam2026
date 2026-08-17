# Routecraft 多運具城市路線 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 將 Routecraft 從單一道路行程升級為台灣城市的一日多運具規劃器，支援 Google Routes、GraphHopper、YouBike、捷運、公車、高鐵與台鐵資料，並能在行程開始後依即時異動重新安排後續路段。

**Architecture:** Gemini 只負責透過自然語言理解需求、追問缺少資訊並產生 typed itinerary command。所有交通資料先由 provider gateway 轉成 Zod 驗證的 normalized mobility evidence，再由 deterministic planner 組合成候選交通段。Google Routes 是一般道路 baseline；GraphHopper 只在淹水、封路、照明不足等硬事件介入；TDX 負責鐵路、捷運、公車與公共自行車的班次、站點、即時狀態與供給資料。

**Tech Stack:** TypeScript、Next.js API routes、Gemini Interactions API、Zod 4、SQLite、Google Routes API、GraphHopper Routing API、TDX Open API、Vitest。

---

## 1. 產品提案與實作邊界

Routecraft 的產品定位是「城市狀態感知的旅遊分流 Agent」：使用者用對話描述想去哪裡、時間、交通偏好與限制，系統產生從出門到回家的完整日行程；城市交通或服務狀態改變時，只重新安排受影響的後續路段。

這份文件整合原本的智慧城市提案與目前可驗證的 local MVP。原本的產品提案保留以下價值：

- 降低使用者自行查詢多個交通平台的成本。
- 不只回答「去哪裡」，也回答「現在是否適合去」與「怎麼去比較不容易失敗」。
- 在有可靠證據時提供替代區域或替代運具，但不宣稱沒有正式資料的人流預測。
- 每個路線變更都能追溯到 provider、時間、狀態與 evidence。

第一階段仍以台北／新北與一日行程為範圍。先完成「多運具查詢 → 可組合交通段 → 即時異動重排」，不做訂票、付款、會員系統，也不建立長期人流模型。

## 2. Provider 分工

| Provider | 負責資料 | 使用時機 | 不負責的事 |
| --- | --- | --- | --- |
| Google Routes | 開車、步行、單車道路 baseline、即時交通時間 | 一般 A→B 路段與道路 last mile | 不直接判斷 YouBike 供給、鐵路停駛或城市安全政策 |
| GraphHopper | 可自訂避開區域的道路候選路線 | 淹水、封路、低照明、硬性道路限制 | 不取代鐵路／公車班次，也不猜測站點供給 |
| TDX | 高鐵、台鐵、捷運、公車、公共自行車、道路事件 | 班次、站點、即時到離站、延誤、營運狀態、YouBike 可借／可還 | 不直接輸出最後可執行的完整日行程 |
| Gemini | 需求理解、追問、解釋與通知文字 | 使用者對話與可理解的變更說明 | 不直接讀第三方 raw JSON、不裁決安全與時間可行性 |

Google Routes 的 Compute Routes 支援道路、步行、單車與 traffic-aware routing；GraphHopper custom model 支援以區域和 priority 規則避開路段。TDX 的資料服務涵蓋公車、軌道、航空、自行車、路況與道路事件，並提供高鐵、台鐵、捷運、公車與公共自行車資料類型。

- [Google Routes API](https://developers.google.com/maps/documentation/routes)
- [Google traffic routing options](https://developers.google.com/maps/documentation/routes/traffic-opt)
- [GraphHopper custom models](https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md)
- [TDX 線上 API 說明](https://tdx.transportdata.tw/api-service/swagger/basic/5fa88b0c-120b-43f1-b188-c379ddb2593d)
- [TDX 資料服務](https://tdx.transportdata.tw/data-service/basic)
- [政府資料開放平台 YouBike 即時服務資料](https://data.gov.tw/dataset/173677)
- [中央氣象署 OpenData API Swagger](https://opendata.cwa.gov.tw/dist/opendata-swagger.html)
- [NCDR 災防資料服務平台](https://datahub.ncdr.nat.gov.tw/)
- [NCDR API 服務說明](https://datahub.ncdr.nat.gov.tw/paradigm)
- [NCDR 淹水預警資料](https://datahub.ncdr.nat.gov.tw/incorporation/flood)

## 3. Typed mobility model

新增 `src/contracts/mobility.ts`，以 Zod 作為所有 provider、planner、SQLite snapshot 與 API 的唯一來源。

### 3.1 運具

```text
MobilityMode
  car
  foot
  bike
  youbike
  metro
  bus
  thsr
  tra
```

### 3.2 標準化證據

```text
MobilityEvidence {
  id
  provider: google_routes | graphhopper | tdx | city_feed
  mode
  observedAt
  fetchedAt
  expiresAt?
  freshness: fresh | stale | unavailable
  status: scheduled | on_time | delayed | suspended | closed | unavailable
  sourceRef
  summary
  evidenceIds[]
}
```

不同 provider 的原始 JSON 不可離開 gateway。TDX 的班次、站點、即時到離站與 YouBike 供給，都先 mapper 成上述 typed evidence。

### 3.3 可排程交通段

```text
MobilityLeg {
  id
  mode
  from: RoutePoint
  to: RoutePoint
  departureAt
  arrivalAt
  durationSeconds
  serviceId?
  routePath?
  transferMinutes?
  status: planned | delayed | blocked | unavailable
  evidenceIds[]
}
```

道路 `routePath` 使用 Google 或 GraphHopper 的共同 `RoutePathSchema`；鐵路、捷運、公車使用 `serviceId`、車站／站牌與班次 evidence，不把大眾運輸假裝成 GraphHopper 道路路徑。

## 4. Planner flow

```text
使用者自然語言
  ↓ Gemini typed command
需求完整度檢查
  ├─ 缺出發地／日期／固定時間 → ask_clarification，保持空白行程
  └─ 資訊足夠 → 建立 stops 與交通偏好
  ↓
Mobility Gateway 查詢
  ├─ Google：道路 baseline
  ├─ TDX：班次、站點、服務狀態、YouBike
  └─ GraphHopper：只有硬事件的道路候選
  ↓
Deterministic Multimodal Planner
  ├─ 固定活動與固定班次不可任意移動
  ├─ 柔性景點可換順序、時段或區域
  ├─ 驗證末班車、轉乘 buffer、營運狀態與回家時間
  └─ 產生 primary plan、alternative plan、findings、evidence
  ↓
Gemini 解釋結果與通知使用者
```

### 4.1 即時城市事件追蹤

目前 MVP 的 `/refresh` 只接受 typed demo signal；它不是背景輪詢，也不代表已經接上官方災情資料。正式追蹤採下列單一路徑：

```text
CWA / NCDR / TDX / YouBike feed
  ↓
server-only gateway
  ↓ Zod mapper
CityEvent + freshness policy
  ↓ event deduplication/version
比對目前行程的 MobilityLeg
  ├─ 沒有影響 → 保存事件，不通知
  └─ 有影響 → 重新計算受影響路段 → 產生 RouteChangeNotification
```

`CityEvent` 必須包含：

```text
CityEvent {
  eventId
  kind: flood | typhoon | heavy_rain | landslide | earthquake
      | road_closure | transit_suspension | transit_delay
      | bike_supply_change
  severity: advisory | warning | severe | critical
  status: active | cleared | stale | unavailable
  affectedAreas[]
  validFrom
  validUntil?
  observedAt
  fetchedAt
  freshness: fresh | stale | unavailable
  source: cwa | ncdr | tdx | youbike
  summary
  evidenceIds[]
}
```

來源責任固定如下：

- CWA：豪雨、颱風、地震與縣市警特報；只採官方預報／警特報欄位，不由 Gemini 推測災害。
- NCDR：淹水、災害警示與可用的影響範圍；資料需保存發布時間、抓取時間與有效期限。
- TDX：高鐵、台鐵、捷運、公車的停駛／延誤與道路事件。
- YouBike／TDX：站點可借車數、可還車位與站點服務狀態。

安全判斷、事件是否影響路段、停駛是否可用與是否必須避開區域，都由 deterministic code 裁決。Gemini 只把已驗證的事件與前後方案說成人類看得懂的內容。任何來源過期或失效都只能是 `stale`／`unavailable`，不可被當成「目前正常」。

### 4.2 路線變更通知必須解釋差異

通知不能只有「路線已更新」。每次改道都要保存並回傳以下 typed payload：

```text
RouteChangeNotification {
  notificationId
  cause {
    kind
    label
    severity
    source
    observedAt
    summary
    evidenceIds[]
  }
  affectedLeg {
    legId
    from
    to
  }
  before {
    mode
    provider
    departAt
    arriveAt
    durationSeconds
    walkingSeconds
    serviceId?
    transferCount
  }
  after {
    mode
    provider
    departAt
    arriveAt
    durationSeconds
    walkingSeconds
    serviceId?
    transferCount
  }
  delta {
    durationSeconds
    walkingSeconds
    transferCount
  }
  reason
  tradeoffs[]
  actionRequired
  evidenceIds[]
}
```

使用者看到的訊息至少要回答：

1. 為什麼改：例如「TDX 回報某捷運路段停駛」或「NCDR 淹水警示覆蓋原步行段」。
2. 哪裡改：明確指出哪一段、原本運具／服務與新運具／服務。
3. 改成什麼：新的出發／抵達時間、步行時間、轉乘數與路線 provider。
4. 代價與風險：多幾分鐘、需要多走路、改搭公車，或某段資料目前是 `stale`。
5. 使用者要做什麼：例如提早出發、到指定替代站、確認改搭，或知道系統已自動保留固定活動。

若沒有可驗證的原因、前後方案或 evidence，系統不得發送「已重新規劃」的成功通知，只回傳 typed `unavailable`／`needs_user`。

空白或模糊行程的規則：

1. 日期由建立 session 時取得；缺日期不可開始規劃。
2. 缺出發地時先追問，不自行假設住宿地點。
3. 缺固定活動時間時可以提出候選，但必須標記為 flexible。
4. 使用者只說「想看展、吃在地料理、不要太趕」時，Gemini 可以提出澄清問題與草案，但不能將草案標成 `ready`，直到出發地、時間範圍與必要限制足夠。
5. 所有交通段都必須包含在行程中，包括走到車站、等車、轉乘、下車到景點與回家。

## 5. 多運具安排規則

### YouBike

- 查詢出發站可借車數量與目的地可還車位。
- 任一端不可用時，先找鄰近站點；沒有可行站點時改用步行、捷運、公車或 Google 道路路線。
- 供給資料過期時只能標記 `stale`，不得顯示成目前可借。

### 捷運與公車

- TDX 先提供路線、站點、預估到站與營運異常。
- 排程保留步行到站、候車、轉乘與下車後步行 buffer。
- 停駛或封閉路段不可被 Gemini 覆寫；planner 必須改找其他路線或回報不可行。

### 高鐵與台鐵

- 使用日期、起訖城市與可接受出發／抵達時間查詢班次。
- 班次是 fixed transit leg；班次延誤時，保留固定活動並只重排柔性活動與後續接駁。
- 高鐵／台鐵本身由 TDX service evidence 描述；車站前後的步行、接駁、開車或單車路段由 Google baseline 規劃，硬事件再交 GraphHopper。
- 不在 MVP 內處理購票、付款、座位鎖定或票價交易。

## 6. Implementation Tasks

### Task 1: Establish canonical docs and contracts

**Files:**

- Create: `src/contracts/mobility.ts`
- Modify: `src/contracts/route.ts`, `src/contracts/itinerary.ts`, `src/contracts/conversation.ts`
- Test: `tests/mobility-contracts.test.ts`

**Steps:**

1. 建立 `MobilityModeSchema`、`MobilityEvidenceSchema`、`MobilityLegSchema`、`TransitServiceSchema`、`BikeStationAvailabilitySchema`。
2. 將 itinerary 的交通段從只有道路 `TravelLeg` 擴充成可包含道路與 transit leg 的 discriminated union。
3. 將 `transportPreferences`、`allowTransfers`、`latestArrivalAt`、`mustUseServiceId?` 加入 Gemini typed command 的需求欄位。
4. 測試每個 mode 的 valid／invalid payload、過期資料、無 evidence、負數車位與錯誤時間窗。

### Task 2: Add a typed TDX gateway

**Files:**

- Create: `src/lib/mobility/tdx-client.ts`
- Create: `src/lib/mobility/tdx-mappers.ts`
- Create: `src/lib/mobility/tdx-catalog.ts`
- Modify: `.env.example`
- Test: `tests/tdx-gateway.test.ts`

**Steps:**

1. 使用 server-only `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`，建立 process-local token cache。
2. 先鎖定台北／新北，盤點並測試 TDX Swagger 的實際 operation，不在 code 中猜 endpoint。
3. 第一批接：高鐵／台鐵時刻與異動、台北／新北捷運站與服務狀態、公車路線與預估到站、公共自行車站點與可借／可還數量。
4. 每個 response 在 gateway 邊界立即 parse；HTTP error、schema error、過期資料與 rate limit 都轉成 typed `unavailable`／`stale`。
5. 使用 mocked fetch 測試 token、HTTP 429、空資料、欄位改變與 freshness policy。

### Task 3: Build multimodal candidate composition

**Files:**

- Create: `src/lib/mobility/candidate-planner.ts`
- Create: `src/lib/mobility/transfer-rules.ts`
- Modify: `src/lib/routing/planner.ts`, `src/lib/itinerary/planner.ts`
- Test: `tests/multimodal-planner.test.ts`

**Steps:**

1. 將每個相鄰 stop pair 拆成 access、main service、egress 三種可能交通段。
2. Google 處理道路 baseline；TDX 回傳 transit candidates；GraphHopper 只處理 hard disruption 的道路 candidate。
3. 使用 deterministic scoring：先排除安全／停駛／過期不可用資料，再比較抵達時間、轉乘數、buffer、步行負擔與使用者偏好。
4. 固定活動、固定高鐵／台鐵班次不得被預測結果任意移動；柔性景點才可重排。
5. 每個 candidate 保存 provider、service、時間窗、風險與 evidenceIds。

### Task 4: Extend conversation and empty-plan flow

**Files:**

- Modify: `src/lib/conversation/gemini.ts`, `src/lib/conversation/fixtures.ts`
- Modify: `src/lib/itinerary/orchestrator.ts`
- Test: `tests/conversation.test.ts`, `tests/day-itinerary-api.test.ts`

**Steps:**

1. 讓 Gemini 理解「想搭高鐵」「從台北到台中」「想騎 YouBike」「不想一直走路」等需求。
2. 缺少出發地、日期、固定抵達時間或必要交通限制時，保持 `discussing` 並追問。
3. 對模糊需求建立可修改草案，不得在沒有完整交通段前回傳 `ready`。
4. 對交通異動只產生 typed command／notification；LLM 不直接寫入 service status 或路線。

### Task 5: Add live multimodal refresh

**Files:**

- Create: `src/contracts/city-events.ts`
- Create: `src/lib/city/event-tracker.ts`
- Create: `src/lib/city/cwa.ts`, `src/lib/city/ncdr.ts`, `src/lib/city/tdx.ts`
- Modify: `src/app/api/day-plans/[id]/refresh/route.ts`
- Modify: `src/lib/itinerary/orchestrator.ts`
- Test: `tests/city-event-tracker.test.ts`, `tests/route-change-notification.test.ts`, `tests/day-itinerary-e2e.test.ts`

**Scenarios:**

- 高鐵／台鐵延誤：保留固定活動，重排接駁與柔性景點。
- 捷運停駛：轉成其他捷運線、公車、步行或 Google 道路段。
- 公車延誤：增加候車風險，選擇替代路線。
- YouBike 無車／無位：改站點或換運具。
- 淹水／封路：Google baseline 保留為 evidence，GraphHopper 產生避開區域的 candidate。
- 豪雨／颱風／地震／淹水警示：只在 CWA 或 NCDR 有有效事件時進入安全評估。
- 所有 provider 過期／失效：回傳 unavailable，不假造城市狀態。

每個異動 e2e 都必須驗證通知包含 `cause`、`affectedLeg`、`before`、`after`、`delta`、`reason`、`tradeoffs` 與 `actionRequired`；只驗證通知存在不算通過。

### Task 6: Verification and real smoke tests

至少驗證：

1. 空白 session → 模糊需求 → 追問 → 補資料 → ready。
2. 只用 Google 的一般道路行程。
3. YouBike 可借／不可借與目的地無停車位。
4. 捷運／公車正常與異常服務。
5. 高鐵／台鐵固定班次與延誤後重排。
6. 淹水／封路時 GraphHopper 只改受影響道路段。
7. 回家交通段永遠存在，除非明確 `returnHome: false`。
8. CWA 豪雨／颱風警特報、NCDR 淹水／災害事件、TDX 停駛／延誤與 YouBike 無車／無位都能轉成 typed event；來源失效時為 `stale`／`unavailable`。
9. 每個改道路線通知都能說明原因、原方案、新方案與差異，不只顯示狀態更新。
10. 真實 Google Routes、GraphHopper、TDX 與至少一個 CWA／NCDR smoke test；測試輸出只保存 typed summary，不保存 API key。

## 7. Environment and acceptance

新增或確認以下 server-only variables：

```text
GOOGLE_MAPS_API_KEY
GOOGLE_ROUTES_BASE_URL=https://routes.googleapis.com/directions/v2:computeRoutes
GRAPHHOPPER_API_KEY
GRAPHHOPPER_BASE_URL=https://graphhopper.com/api/1
TDX_CLIENT_ID
TDX_CLIENT_SECRET
TDX_BASE_URL=https://tdx.transportdata.tw
```

驗收條件：

- 沒有交通資料時不會把 Google 道路路線冒充成捷運、公車或火車。
- 沒有正式班次／供給資料時，系統明確顯示 `unavailable` 或 `stale`。
- 一般道路行程不呼叫 GraphHopper；只有硬事件才呼叫。
- 固定活動與固定班次不因模糊預測被任意刪除或移動。
- 所有交通段、服務異動、風險 finding、通知與 API response 通過 Zod。
- `pnpm test -- --run`、`pnpm run lint`、`pnpm run build` 全部通過。
