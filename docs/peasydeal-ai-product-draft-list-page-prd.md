# AI Product Draft — Product Drafts IA/Route PRD (`/products/drafts`)

## 1) Summary
在 Admin Console 新增獨立的 `Product Drafts` 導覽項目與列表頁，讓管理者可一次查看所有 draft、依狀態分流處理、快速進入審稿頁，提升多筆草稿作業效率。

同時將「建立 draft」流程明確保留在 `AI Import`：
- `Product Drafts` 負責管理/審稿
- `AI Import` 負責建立新 draft

本 PRD 聚焦：
1. UI/UX 呈現（資訊架構、互動、狀態）
2. 技術實作可行性評估（前端改動、API 依賴、風險、工時）

---

## 2) Background
- 目前 `AI Import` 入口同時承擔建立與管理語意，資訊架構混在一起。
- 管理者無法快速回答以下問題：
  - 現在有多少筆 `READY_FOR_REVIEW` 待處理？
  - 哪些 draft `FAILED` 需要追蹤？
  - 哪些已 `PUBLISHED` / `REJECTED`？
- 現有單筆審稿頁功能已完整（編輯、儲存、發佈、拒絕），缺的是「列表層級的工作台」。

---

## 3) Goals / Non-goals

### Goals
1. 在右側 option list 提供獨立 `Product Drafts` 項目。
2. 提供 Product Draft 列表，預設顯示最新更新資料。
3. 讓管理者可依狀態快速篩選（Ready/In-progress/Failed/Published/Rejected）。
4. 支援快速動作：進入 Review、開啟來源網址。
5. 保持與現有審稿頁狀態語意與色彩一致。
6. `New Draft` 一律導向 `/products/ai-import`（不使用 `/products/ai-import/create`）。

### Non-goals
1. 本需求不改動 draft 編輯欄位（在 detail page 處理）。
2. 本需求不新增 crawl/publish/reject 後端業務邏輯。
3. 本需求不做批次 publish/reject（bulk actions）。
4. 本需求不做即時 websocket；MVP 使用 polling/手動 refresh。

---

## 4) Scope

### In Scope
- 路由與導覽調整（新增 `Product Drafts` 入口）
- Draft list 頁面 UI（Header、filters、table、empty/loading/error states）
- List API client（`listProductDrafts`）
- 與現有 `show` 頁串接（row click / Review action）

### Out of Scope
- 後端 schema 變更（除非需要補 list summary 欄位）
- 批次操作
- 權限模型調整

---

## 5) IA and UX Design

### 5.1 Page Information Architecture
1. Header 區
- Title: `Product Drafts`
- Secondary text: 簡短說明用途（例如：`Track and review AI-generated product drafts`）
- CTA: `New Draft`（導到 `/products/ai-import`）

2. Status Summary 區（可點擊 chip）
- `Ready`
- `In Progress`（`QUEUED_FOR_DRAFT | CRAWLING | DRAFTING | FOUND`）
- `Failed`
- `Published`
- `Rejected`

3. Filter / Search / Sort 工具列
- Status tabs: `All / Ready / In Progress / Failed / Published / Rejected`
- Search: 支援 `draft id` 與 `source url` 關鍵字
- Sort: `Updated (newest first)`（MVP 固定）
- Refresh: 手動刷新按鈕
- Auto refresh: 當目前結果包含 in-progress 狀態時，每 15 秒自動刷新

4. List Table 區
- 欄位：
  - `Status`（badge）
  - `Draft ID`
  - `Source`（domain + truncated URL）
  - `Updated`
  - `Actions`（Review / Open Source）

5. 狀態區
- Loading: skeleton rows
- Empty (no data): 引導建立新 draft
- Empty (filtered): 提供 `Clear filters`
- Error: inline alert + retry

### 5.2 Interaction Principles
1. 先分流再處理：狀態為第一優先篩選維度。
2. 快速進入單筆：每列都有明確 `Review` CTA。
3. 資訊密度適中：列表只放決策必要欄位，不塞 detail payload。
4. 保持語意一致：badge 文案/顏色沿用現有 detail 頁邏輯。

---

## 6) User Flows

1. Queue triage flow
- 打開 Product Drafts
- 點 `Ready` chip 或切到 `Ready` tab
- 依 updated time 處理前幾筆
- 點 `Review` 進入單筆頁

2. Failure follow-up flow
- 點 `Failed`
- 找出失敗 draft
- 點 `Review` 查看錯誤內容與來源 URL

3. New import flow
- 在 list 頁按 `New Draft`
- 到 `/products/ai-import` 貼 URL 建立
- 建立成功後導到 `/products/drafts/:id`

---

## 7) Route and Navigation Design

建議路由調整：
1. `GET /products/drafts` -> Product Drafts List Page（新）
2. `GET /products/drafts/:id` -> Draft Detail/Review（主要）
3. `GET /products/ai-import` -> Create Draft Page（建立入口）
4. `GET /products/ai-import/:id` -> optional compatibility redirect 到 `/products/drafts/:id`

導覽策略：
1. Sidebar 新增 `Product Drafts`，指到 `/products/drafts`。
2. `AI Import` 可保留為建立入口（指到 `/products/ai-import`）。
3. List header 的 `New Draft` 按鈕導向 `/products/ai-import`。
4. Detail 頁 `New Draft` 按鈕導向 `/products/ai-import`。

---

## 8) API Contract (MVP)

### 8.1 Required List Endpoint
`GET /v1/admin/product-drafts`

Query (MVP):
- `status` (optional)
- `q` (optional; draft id/url contains)
- `limit` (optional, default 50)
- `cursor` (optional; if backend supports)

Response (MVP expected):
```json
{
  "items": [
    {
      "id": "draft_uuid",
      "status": "READY_FOR_REVIEW",
      "url": "https://example.com/...",
      "updated_at_ms": 1739999999999
    }
  ],
  "next_cursor": null
}
```

### 8.2 Optional Enrichment (Phase 2)
若要提升列表可讀性，可增加 summary 欄位：
- `title`
- `price`
- `currency`
- `thumbnail_url`
- `error`

---

## 9) Frontend Technical Design

### 9.1 New Modules
1. `src/pages/products/ai-import/list.tsx`
2. `src/lib/admin-ai-product-drafts.ts` 新增：
- `type ProductDraftListItem`
- `type ListProductDraftsQuery`
- `listProductDrafts(query)`

3. 路由可拆為 `src/pages/products/drafts/*`（建議）或維持 `ai-import` 目錄但映射到 `/products/drafts/*`
4. `src/App.tsx` resources 與 route 調整（新增 `product_drafts` 導覽）

### 9.2 Data Fetch Strategy
1. 首次進頁請求 list API。
2. 使用單一 list API，不對每列再打 detail API（避免 N+1）。
3. 搜尋輸入採 debounce（300ms）。
4. Auto refresh 僅在結果包含 in-progress 狀態時啟用。
5. status/search/sort 改變時重抓資料，保留 URL query 方便分享與返回。

### 9.3 Rendering Strategy
1. 欄位定義使用 `useMemo`，避免 column 物件反覆建立。
2. row actions callback 使用穩定引用，降低不必要 re-render。
3. 大欄位（URL）做 truncate + tooltip/title，避免表格排版抖動。

---

## 10) Implementation Feasibility Assessment

### 10.1 Current Readiness
1. 已有 detail page 的 status label/color 邏輯，可重用。
2. 既有 DataTable 元件可直接承載列表頁。
3. MSW 已有 list mock endpoint，利於本地快速驗證流程。

### 10.2 Required Changes
1. 補 list API client（目前缺）。
2. 調整路由：list 與 create 拆路徑。
3. 更新 create/detail 內的導向按鈕目標。
4. 若正式 backend 與 mock endpoint path 不一致，需先對齊（`/v1/admin/...` vs `/v1/...`）。

### 10.3 Risk Level
- 整體風險：`Low ~ Medium`
- 主風險在 API contract 對齊，不在 UI 開發本身。

---

## 11) Effort Estimate

### Frontend Estimate
1. MVP UI + route + API client：`1 ~ 1.5` 天
2. UX polish（summary chips、empty/error 文案、auto refresh）：`0.5` 天
3. 聯調與修正：`0.5` 天

合計：`2 ~ 2.5` 天（含基本測試）

### Backend Dependency Estimate
1. 若現有 list API 已可用且 path 對齊：`0` 天依賴阻塞
2. 若需補 `q/cursor` 或 summary 欄位：`0.5 ~ 1` 天

---

## 12) Risks and Mitigations

1. Risk: API path 不一致（mock 與 real backend）
- Mitigation: PR 開始前先凍結 contract，並在 API client 統一 `/v1/admin/product-drafts`。

2. Risk: List response 欄位不足導致 UI 只能顯示很少資訊
- Mitigation: MVP 先用 `id/status/url/updated_at_ms`，Phase 2 再補 summary 欄位。

3. Risk: Auto refresh 造成多餘流量
- Mitigation: 僅在 in-progress 狀態啟用；背景頁面可停用（visibility API）。

4. Risk: Route 變更影響既有操作習慣
- Mitigation: 保留 `AI Import` 為 create 入口，且保留 `ai-import/:id -> drafts/:id` 相容 redirect。

---

## 13) Rollout Plan

1. Phase 1 (MVP)
- 上線 `Product Drafts` list page、status filter、search、review 連結、new draft 入口

2. Phase 2 (Optimization)
- 加 summary 欄位（title/price/thumbnail）
- 加 cursor pagination（若資料量成長）

3. Phase 3 (Advanced)
- 批次操作與更完整營運 dashboard（非本期）

---

## 14) QA Test Matrix

1. Navigation
- Sidebar 點 `Product Drafts` 進入 list（`/products/drafts`）。
- List 的 `New Draft` 正確導到 `/products/ai-import`。
- Row `Review` 正確導到 `/products/drafts/:id`。

2. Filtering and Search
- 各 status tab 結果正確。
- Search 可匹配 draft id / url。
- Clear filters 可回復資料。

3. Data States
- Loading / empty / error 顯示正確。
- Auto refresh 僅在 in-progress 狀態啟動。

4. Regression
- Create flow 不受影響。
- Detail publish/reject/save flow 不受影響。

---

## 15) Acceptance Criteria

1. 右側 option list 有獨立 `Product Drafts` 項目，入口為 `/products/drafts`。
2. 管理者可透過 status tab 快速查看不同狀態 draft。
3. 每列可直接進入 `/products/drafts/:id` review 頁處理。
4. 列表至少顯示：status、draft id、source url、updated time。
5. 系統在 in-progress 狀態下可自動刷新，避免手動狂按 refresh。
6. `New Draft` 一律導到 `/products/ai-import`，建立成功後導到 `/products/drafts/:id`。

---

## 16) Open Questions

1. list API 最終路徑是否定案為 `/v1/admin/product-drafts`？
2. MVP 是否需要 `q` 搜尋由 backend 處理，或先前端 client-side filter 即可？
3. 是否要在 MVP 直接顯示 `title/price/thumbnail`，還是先維持精簡欄位？
4. 是否需要在 list 頁提供 `FAILED` 的快速重試按鈕（若 backend 支援 retry）？

---

## 17) Confirmed Decisions (2026-02-25)

1. `Product Drafts` 必須是獨立選單項目，不與 `AI Import` 共用同一路由語意。
2. `New Draft` 目的地為 `/products/ai-import`（不使用 `/products/ai-import/create`）。
3. 建立 draft 成功後，導向 `/products/drafts/:id`。
4. 可保留 `/products/ai-import/:id` 作為相容 redirect 到 `/products/drafts/:id`。
