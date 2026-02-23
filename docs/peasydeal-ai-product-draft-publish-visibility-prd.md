# AI Product Draft — Publish Visibility (`上架`) PRD

## 1) Summary
在 Admin Console 的 AI Import Draft Review 頁新增一個 `上架` checkbox。  
當 operator 勾選後再按 `Publish`，商品建立後立即對客人可見並可下單；未勾選則商品建立但對客人不可見。

---

## 2) Background
- 目前 AI Import 的 `Publish` 流程沒有「可見性」控制欄位，操作員無法在發布當下決定是否上架。
- 營運需求常見兩種情境：
  - 立即上架：資料確認後直接販售。
  - 先不上架：先建立商品，待補素材/檢查後再上架。
- 若僅做前端 checkbox 而後端不接收與落庫，需求不會真正生效。

---

## 3) Goals / Non-goals

### Goals
1. 在 AI Import Review (`READY_FOR_REVIEW`) 新增 `上架` checkbox。
2. `Publish` 時將可見性一併送到後端，並寫入最終商品。
3. 前台商品查詢遵守此可見性，未上架商品不對客可見。
4. 預設值可配置且明確（建議預設勾選，維持現有「發佈即上架」直覺）。

### Non-goals
1. 不設計排程上架（定時生效）。
2. 不新增多層可見性權限模型（例如區域/會員等級可見）。
3. 不改動 AI crawl/draft pipeline 的抽取邏輯。

---

## 4) Scope
- 頁面：`/products/ai-import/:id`
- 模組：
  - Draft review UI（新增 checkbox）
  - Publish API contract（新增 publish visibility 參數）
  - Product create/publish backend mapping
  - Storefront product listing filter（僅顯示可見商品）

---

## 5) Terms & Definitions
- `上架`：商品對客人可見且可下單。
- `下架`：商品對客人不可見且不可下單。
- 欄位命名（已定案）：
  - Product 層：`visibility`（boolean）
  - Publish request：`visibility`（boolean）

---

## 6) Functional Requirements

1. FR-1 Checkbox 呈現
- 在 `READY_FOR_REVIEW` 的 publish controls 區塊顯示 checkbox：
  - Label：`上架`
  - Helper text：`勾選後發佈即對客可見，可立即下單`

2. FR-2 預設值
- 預設值由系統設定決定（MVP 建議 `true`）。
- 若未來要調整為 `false`，需產品決策明確告知操作流程改變。

3. FR-3 Publish request 攜帶可見性
- 點擊 Publish 時，前端需將 checkbox 值送至 publish endpoint。
- 例：`POST /v1/product-drafts/{id}/publish` body 帶入可見性欄位。

4. FR-4 後端落庫與生效
- 後端 publish 建立 product 時，必須寫入可見性欄位。
- 客戶端查詢與下單路徑需遵守該欄位（未上架不可見/不可下單）。

5. FR-5 回傳一致性
- Publish response 建議回傳最終可見性，避免前端猜測。

---

## 7) API Contract (Proposed)

### 7.1 Publish
`POST /v1/product-drafts/{draft_id}/publish`

Request (proposed):
```json
{
  "final_payload": {
    "visibility": true
  }
}
```

Response (proposed):
```json
{
  "draft_id": "uuid",
  "status": "PUBLISHED",
  "product_id": "uuid",
  "visibility": true
}
```

### 7.2 Backward compatibility
- 若前端未帶 `visibility`：
  - 後端使用預設值（建議 `true`，避免破壞既有流程）。
- 若後端尚未支援此欄位：
  - 前端應提示「目前環境不支援上架控制」或暫時隱藏控制項（由 feature flag 決定）。

---

## 8) Data Model Impact

### Product table
- 需有可見性欄位（若已存在沿用）：
  - `visibility BOOLEAN NOT NULL DEFAULT true`

### Product Draft table
- MVP 不強制在 draft table 儲存此值（只在 publish action 傳入即可）。
- 若要保留歷史決策，可在 event log 記錄 publish payload。

---

## 9) UX Requirements
1. 控件位置：放在 `Publish` 按鈕附近，避免使用者忽略。
2. 文案清楚：必須讓 operator 知道「未勾選即客人看不到」。
3. 與現有流程一致：
- 仍維持「有 unsaved changes 不可 publish」規則。
- 仍維持 category required before publish 規則。
4. 可操作性：
- checkbox 狀態改變應即時反映，無需先 `Save changes`（若屬 publish-only 參數）。

---

## 10) Validation Rules
1. `visibility` 僅接受 boolean。
2. 缺值時套用後端預設值。
3. 其餘 publish 前置檢核（category、draft status）維持不變。

---

## 11) Security / Audit
1. 只有有 publish 權限的管理者可設定上架與發布。
2. 建議在 `product_draft_events` 或產品 audit log 記錄：
- 操作人
- draft_id / product_id
- `visibility` 值
- 時間

---

## 12) Rollout Plan
1. Backend 先上：
- 支援 publish payload 的 `visibility`
- 支援回傳最終可見性
2. Frontend 再上：
- 顯示 checkbox 並送出參數
3. Feature flag（可選）：
- `ai_import_publish_visibility_enabled`
- 用於灰度環境驗證

---

## 13) Acceptance Criteria
1. 在 `READY_FOR_REVIEW` 可看到 `上架` checkbox。
2. 勾選上架後 publish，商品對客可見且可下單。
3. 未勾選上架後 publish，商品對客不可見且不可下單。
4. 不影響既有 save/reject/publish 主流程與錯誤處理。
5. 舊前端（不帶 `visibility`）仍可 publish（由後端預設值接管）。

---

## 14) QA Test Matrix
1. Default true：
- 不動 checkbox 直接 publish，商品應可見。
2. Explicit false：
- 取消勾選後 publish，商品不可見。
3. Toggle correctness：
- true/false 切換後 publish，最終 product 狀態與 payload 一致。
4. Backward compatibility：
- 模擬舊版前端 publish（無欄位）仍成功，且套用預設值。
5. Regression：
- category required、dirty-state guard、reject flow 不退化。
6. Permission：
- 無 publish 權限帳號不可操作 publish visibility。

---

## 15) Confirmed Decisions
1. 預設值：`visibility=true`。
2. 欄位命名：`visibility`。
3. Publish 成功後 UI 需要顯示結果狀態（例如：`已上架` / `未上架`）。

## 16) Operation Policy Note
- 「未上架商品是否允許在後台直接建立庫存與價格調整」不是此功能的技術阻塞，而是營運流程政策設定。
- 建議由產品/營運另行定義權限與 SOP；本 PRD 只處理「AI Import publish 時的可見性控制」。
