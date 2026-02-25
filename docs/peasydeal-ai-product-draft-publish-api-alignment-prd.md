# AI Product Draft — Publish API Alignment PRD (`/v1/admin/product-drafts/{draft_id}`)

## 1) Summary
將 AI Import Draft Review 頁的 `Publish` 串接從舊契約切換到新契約：

- 舊：`POST /v1/product-drafts/{draft_id}/publish`，body 為 `{ draft_id, final_payload }`
- 新：`POST /v1/admin/product-drafts/{draft_id}`，body 為扁平 payload（含 `draft_id`）

目標是讓前端送出的 request payload 完整符合後端新格式，且不破壞現有 operator 流程（Save/Publish/Reject、dirty-state、category required）。

---

## 2) Background
- 現有 `Publish` 流程已可在 `READY_FOR_REVIEW` 下操作，並送出完整編輯資料。
- 但目前 request shape 與新 API 不一致：
  - endpoint 不同
  - body 結構不同（nested vs flat）
- 若不對齊，切換後端後會造成 publish 失敗或資料解析錯誤。

---

## 3) Goals / Non-goals

### Goals
1. 前端 publish request 完整符合新 API endpoint 與 payload shape。
2. 保留既有 UI 行為與發佈前 guard 規則。
3. 型別、mock、錯誤處理一起對齊，避免本地開發/測試偏差。
4. 明確定義欄位 mapping 與 payload 正規化行為。

### Non-goals
1. 不變更 draft 編輯欄位範圍與 UX 佈局。
2. 不調整後端資料模型與業務邏輯。
3. 不在本需求內新增資產上傳服務（目前仍沿用既有 image serialize 行為）。

---

## 4) Scope
- 頁面：
  - `/products/ai-import/:id` (`READY_FOR_REVIEW` 的 `Publish` 行為)
- 模組：
  - `src/pages/products/ai-import/show.tsx`（publish 送出邏輯）
  - `src/lib/admin-ai-product-drafts.ts`（API client 與 type）
  - `src/mocks/handlers.ts`（MSW mock contract）

---

## 5) API Contract

### 5.1 Target Endpoint
`POST /v1/admin/product-drafts/{draft_id}`

### 5.2 Request Payload (target shape)
```json
{
  "draft_id": "fc77d8a2-cf4b-4c14-a0c4-35119a3f9c3f",
  "shipping_fee": 2.99,
  "tax_rate": 0.2,
  "category_ids": [123, 456],
  "category_branch": [
    { "id": 123, "tier": 1, "is_leaf": false },
    { "id": 456, "tier": 2, "is_leaf": true }
  ],
  "title": "Product title",
  "description": "Product description",
  "currency": "TWD",
  "price": "399.00",
  "images": ["https://example.com/main.jpg"],
  "variations": [
    {
      "images": ["https://example.com/blue.jpg"],
      "position": 0,
      "price": "399.00",
      "title": "Blue"
    }
  ],
  "main_image_ref": {
    "container": "main",
    "variation_position": null,
    "url": "https://example.com/main.jpg"
  },
  "status": "READY_FOR_REVIEW",
  "url": "https://source-url",
  "visibility": true
}
```

### 5.3 Response (assumption for frontend)
至少需包含：
- `draft_id`
- `status`（預期 `PUBLISHED`）
- `product_id`
- `visibility`（若後端有回傳）

若最終 response 與以上不同，需再調整前端 success message 的欄位來源。

---

## 6) Current vs Target Comparison

1. Endpoint
- Current: `/v1/product-drafts/{id}/publish`
- Target: `/v1/admin/product-drafts/{id}`

2. Body Shape
- Current:
```json
{
  "draft_id": "xxx",
  "final_payload": { "...flatten fields..." }
}
```
- Target:
```json
{
  "draft_id": "xxx",
  "...flatten fields..."
}
```

3. Field Content
- 大多欄位目前已在 `toPayload` 生成，主要是要改為 root-level 送出。
- `visibility` 目前在 publish 前已補入，沿用即可。

---

## 7) Frontend Functional Requirements

1. FR-1 Publish 呼叫改走新 endpoint
- `publishProductDraft` 改為 `POST /v1/admin/product-drafts/{draft_id}`。

2. FR-2 Publish payload 改為扁平
- `onPublish` 內組裝 payload 時，不再包 `final_payload`。
- 最終 request body 必須含 `draft_id` 及所有編輯欄位。

3. FR-3 Guard 行為不變
- 仍保留：
  - category required before publish
  - dirty-state 阻擋 publish
  - in-flight button disabled 行為

4. FR-4 錯誤與成功提示不退化
- publish success/fail notification 保持可讀性。
- 後端若回 `visibility` 仍顯示「已上架/未上架」。

5. FR-5 Mock 對齊
- MSW handler 更新為新 endpoint 與新 body shape，避免本地測試誤判。

6. FR-6 Publish 前 preflight validation（UI 層）
- 在呼叫 publish API 前，前端需先檢查以下條件並提供可讀錯誤訊息：
  - `title` 非空
  - `currency` 為 3 碼大寫字母
  - `price` 為正數 numeric string
  - `shipping_fee >= 0`
  - `tax_rate >= 0`
  - `category_ids` 非空
  - `category_branch` 至少有一個 `is_leaf=true` 且第一個 leaf id 存在於 `category_ids`
  - `images` + `variations[*].images` 合併後至少有一張可用圖片 URL
  - `variations[*].position` 不可重複
  - `main_image_ref` 需滿足 container/url/variation_position 規則

7. FR-7 後端驗證結果優先
- 前端 preflight validation 只做早期阻擋與 UX 提示，後端驗證仍是最終權威。

---

## 8) Payload Compliance Rules

1. `draft_id`
- 必填，且需與 path param 一致。

2. `shipping_fee`
- 必填 JSON number，且 `>= 0`。

3. `tax_rate`
- 必填 JSON number，且 `>= 0`。

4. `category_ids` / `category_branch`
- `category_ids` 必須為非空 number array。
- `category_branch` 必須至少有一個 `is_leaf=true`。
- `category_branch` 第一個 leaf 的 `id` 必須存在於 `category_ids`。

5. `images` / `variations[].images`
- `images` 與 `variations[*].images` 合併集合後，至少要有 1 筆可用圖片 URL。
- `main_image_ref.url` 必須存在於此合併集合內。

6. `variations[].position`
- 不能重複。

7. `variations[].price`
- optional；當空值時 fallback 為 top-level `price`。

8. `main_image_ref`
- `container` 只能是 `"main"` 或 `"variation"`。
- `url` 必填，且需存在於 draft image set（`images` 或 `variations[*].images`）。
- 當 `container="variation"` 時，`variation_position` 必填。

9. `title` / `currency` / `price`
- `title` 必填且不可空字串。
- `currency` 必填，且必須是 3 碼大寫字母（例如 `TWD`）。
- `price` 必填，且必須是正數 numeric string（例如 `"399.00"`）。

10. `status`
- optional；若有值只能是 `READY_FOR_REVIEW`。

11. `visibility`
- 由 `Publish` 區塊 checkbox 控制，預設 `true`。

---

## 9) Compatibility and Migration Strategy

1. 切換策略
- 以新 endpoint/new payload 為主，不做雙寫。
- 若需灰度，可加 feature flag：`ai_import_publish_api_v2_enabled`（可選）。

2. 失敗回退策略（可選）
- 若後端尚未全環境上線，可短期提供 fallback 到舊 endpoint。
- 若不做 fallback，需確認環境先完成後端部署再上前端。

---

## 10) Implementation Plan

1. API Client
- 更新 `PublishProductDraftRequest` 型別，改為扁平 publish payload（含 `draft_id`）。
- 更新 `publishProductDraft` endpoint path。

2. Publish Call Site
- `show.tsx` 的 `onPublish`：
  - `toPayload(...)` 結果展開到 root body
  - 注入 `draft_id` 與 `visibility`
  - 呼叫新 API client

3. Mock & Local Validation
- 更新 `src/mocks/handlers.ts` publish handler：
  - endpoint
  - body parser（讀 root-level 欄位，不讀 `final_payload`）

4. Regression Check
- Save changes、Publish、Reject、Reset、Category search、dirty-state。
- 加上 publish preflight validation 的錯誤提示與按鈕阻擋檢查。

---

## 11) QA Test Matrix

1. Happy path publish
- `READY_FOR_REVIEW` 下無 dirty、有 category，點 publish 成功。
- request URL 為 `/v1/admin/product-drafts/{draft_id}`。
- request body 為扁平格式，含 `draft_id` + payload fields + `visibility`。

2. Visibility path
- `visibility=true/false` 各測一次，request body 值正確。

3. Guard regression
- dirty 時 publish disabled。
- category 空時 publish disabled + 錯誤提示。

4. Payload field integrity
- variation price、main_image_ref、category_branch、tax/shipping 有正確帶入。

5. Contract validation cases
- title 空值 -> 不送 API，顯示錯誤
- currency 非 3 碼大寫 -> 不送 API，顯示錯誤
- price 非正數字串 -> 不送 API，顯示錯誤
- category_branch 無 leaf 或 leaf id 不在 category_ids -> 不送 API，顯示錯誤
- 無可用圖片或 main_image_ref.url 不在 image set -> 不送 API，顯示錯誤
- variation positions 重複 -> 不送 API，顯示錯誤
- status 非 READY_FOR_REVIEW（若有）-> 不送 API，顯示錯誤

6. Mock parity
- 本地 MSW 模式下 publish 流程可通，回傳狀態更新正常。

---

## 12) Risks and Mitigations

1. Risk: 後端 response shape 與目前前端假設不一致
- Mitigation: 先與 backend 對齊 publish response schema，必要時放寬前端解析。

2. Risk: 後端不接受 data URL 圖片
- Mitigation: 若 backend 需 `http(s)`，另開 image upload flow（upload -> URL）需求。

3. Risk: 現有前端 `tax_rate` 會做上限 1 的 clamp，與新契約（僅要求 `>=0`）不一致
- Mitigation: 實作時調整為只做非負數檢查，不做上限截斷。

4. Risk: 現有前端未完整實作 title/currency/price/main_image_ref 等 publish 前阻擋
- Mitigation: 在 `onPublish` 加 preflight validation，並提供可讀錯誤訊息。

---

## 13) Acceptance Criteria

1. 點擊 `Publish` 時，前端使用 `POST /v1/admin/product-drafts/{draft_id}`。
2. request body 與指定 JSON 格式一致（扁平，不包 `final_payload`）。
3. 原有 publish guard 與 review 編輯流程不退化。
4. 前端 publish request 可通過上述 API contract 的欄位約束。
5. MSW mock 與前端 contract 一致。
6. 使用者在 UI 仍可收到成功/失敗明確提示。

---

## 14) Open Questions

1. 後端對「usable image URL」的定義是否明確限制為 `http(s)`？
2. 新 endpoint response 是否固定回傳 `product_id` 與 `visibility`？
4. 是否需要在 transition 期間保留舊 endpoint fallback？
