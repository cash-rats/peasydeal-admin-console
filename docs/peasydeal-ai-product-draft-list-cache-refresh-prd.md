# AI Product Draft — List Cache + Manual Refresh PRD (`/products/drafts`)

## 1) Summary
將 Product Drafts List 從「每次切 filter 都打 API」改為「首載入建立前端快取 + 本地 filter/search + operator 手動 refresh」。

目標是降低操作延遲、減少重複 API 請求、改善 operator 在高頻切換 status 時的可用性。

---

## 2) Background
- 現況：切換 `READY_FOR_REVIEW / FAILED / PUBLISHED / REJECTED` 會重新 fetch API。
- 問題：
  1. 切 filter 的等待感明顯，operator 容易重複點擊。
  2. 重複發送同型查詢，增加 BE 壓力。
  3. loading 時 UI 互動受限，操作流不連續。

---

## 3) Goals / Non-goals

### Goals
1. Filter/search 切換時間接近即時（以 FE 記憶體資料計算）。
2. API 呼叫聚焦在「首載入」與「手動 refresh」。
3. 保留資料新鮮度控制：operator 可明確觸發 refresh。
4. 提供清楚同步狀態：`Updating...`、`Last synced time`。

### Non-goals
1. 不改 backend API contract。
2. 不新增 websocket / SSE / push 機制。
3. 不變更 draft detail 的 publish/reject/save 行為。

---

## 4) Scope
- 頁面：`/products/drafts` list page
- 模組：
  - `src/pages/products/ai-import/list.tsx`
  - （可選）抽出 list cache store 至同目錄獨立檔案

---

## 5) Product Decisions
1. 保留 status filter：`ALL`, `READY_FOR_REVIEW`, `FAILED`, `PUBLISHED`, `REJECTED`。
2. API `limit` 使用 `30`（已調整）。
3. Filter/search 一律不觸發 API，改用本地資料運算。
4. `Refresh` 由 operator 手動觸發；refresh 期間不鎖 filter/search。
5. refresh 期間保留舊資料顯示，避免畫面空白。

---

## 6) Data Fetch Strategy

### 6.1 Initial Load
1. 進入頁面後請求 `GET /v1/admin/product-drafts?limit=30`。
2. 回傳資料存入 FE cache（正規化結構）。
3. 若 `next_cursor` 存在，可背景續抓下一頁直到結束（漸進補齊）。

### 6.2 Manual Refresh
1. 點擊 refresh icon/button 後重新抓取最新資料。
2. refresh in-flight 時禁用 refresh 按鈕，避免重複任務。
3. refresh 完成後更新 `lastSyncedAtMs`。

### 6.3 Filter/Search
1. status filter：本地過濾。
2. q search（draft id / source url）：本地 case-insensitive 比對。
3. 排序固定 `updated_at_ms desc`。

---

## 7) Frontend State Design

建議使用 reducer（同頁或抽離）管理 cache：

```ts
type DraftCacheState = {
  entitiesById: Record<string, ProductDraftListItem>;
  orderedIds: string[];
  isBootstrapping: boolean;
  isRefreshing: boolean;
  lastSyncedAtMs: number | null;
  error: string | null;
};
```

衍生資料（`useMemo`）：
1. `allItems`：依 `orderedIds` 映射實體。
2. `filteredItems`：套用 status + search。
3. `summary`：ready/failed/published/rejected counts（基於 cache）。

---

## 8) UX Requirements
1. 首次載入（無 cache）：
  - 顯示 skeleton rows。
2. 已有 cache 時 refresh：
  - 顯示 `Updating...`，但保留目前列表可操作。
3. filter/search：
  - 不顯示 blocking loading。
  - 操作立即生效。
4. 錯誤狀態：
  - 保留已存在 cache（若有），顯示 non-blocking error alert + retry。

---

## 9) API Contract Usage
- Endpoint：`GET /v1/admin/product-drafts`
- Query params：
  - `limit=30`
  - `cursor`（分頁）
- 本期不依賴 `status` / `q` server-side 查詢（前端處理 filter/search）。

---

## 10) Implementation Plan
1. 重構 list page 的資料流：fetch 與 view filter 分離。
2. 導入 reducer cache，替換目前 `rows + nextCursor + statusFilter fetch` 模式。
3. refresh 改為唯一手動更新入口（並顯示 updating 狀態）。
4. 移除「filter 點擊 -> API」依賴。
5. 驗證空態、錯誤態、refresh 中互動行為。

---

## 11) QA Test Matrix
1. 首次進頁：
  - 會 fetch API 並渲染資料。
2. 切換 status tabs：
  - 不產生新的 list API request。
  - 顯示結果正確。
3. 搜尋關鍵字：
  - 不產生新的 list API request。
  - draft id / source url 比對正確。
4. 點 refresh：
  - 會發起 API request。
  - refresh 期間按鈕 disabled，filter/search 仍可操作。
5. API 錯誤：
  - error alert 顯示。
  - 若已有舊資料，不清空列表。

---

## 12) Risks and Mitigations
1. 風險：資料量變大，首次載入時間變長。
   - 緩解：`limit=30` + 漸進分頁補齊。
2. 風險：資料可能過舊。
   - 緩解：明確顯示 `Last synced`，提供手動 refresh。
3. 風險：本地搜尋在超大資料集效能下降。
   - 緩解：維持 debounce、必要時加 virtualization（後續優化）。

---

## 13) Acceptance Criteria
1. 切 status filter 不再打 list API。
2. 切 search 不再打 list API。
3. 僅首次載入與 manual refresh 會打 list API。
4. refresh 期間 operator 仍可切 filter/search。
5. `Last synced` 與 `Updating...` 狀態可見且正確。

---

## 14) Rollout
1. Phase 1：單頁重構（list page only）。
2. Phase 2（可選）：抽離 cache store 供其他列表共用。
3. Phase 3（可選）：TTL / background refresh 策略優化。
