# AI Product Draft Image Upload API PRD

## 1. Summary

為了解決 AI 修圖或手動新增圖片後，`Save changes` 因 request payload 過大而失敗的問題，新增一個後端圖片 upload API。

新的儲存流程改為：

1. Operator 在 draft review 頁面接受 AI 修圖結果或新增本地圖片
2. Operator 按 `Save changes`
3. 前端先把所有本地圖片 upload 到後端 image upload API
4. 後端把圖片存到 storage，回傳 hosted URL
5. 前端再呼叫既有 `PUT /v1/admin/product-drafts/{draft_id}`，payload 內只放圖片 URL，不再放 base64 data URL

目標是讓 draft update API 永遠只處理結構化資料與 hosted URLs，不再承載圖片本體。

---

## 2. Problem Statement

目前前端在儲存 draft 時，會把新圖片或 AI 修圖後的圖片轉成 base64 data URL 後塞進 draft payload。

這會導致：

- request body 非常大
- base64 比原始 binary 還膨脹
- Vercel Functions 容易回 `Content Too Large`
- draft update API 同時承擔 metadata update 與 binary transport，職責錯誤

這個問題在以下情境都會出現：

- AI image edit accept 後的圖片
- operator 手動 upload 的新圖片
- variation images 的新圖片

---

## 3. Goals

1. 提供一個可由 admin console 呼叫的圖片 upload API。
2. 讓前端在 `Save changes` 時先 upload 本地圖片，再把 URL 寫入 draft payload。
3. 讓 `PUT /v1/admin/product-drafts/{draft_id}` 不再接收 base64 image data。
4. 支援 main images 與 variation images 的共用流程。
5. 保留現有 operator UX：`Accept` 不會立刻存檔，只有 `Save changes` 才正式提交。

## 4. Non-goals

1. 本需求不改動 AI image edit Gemini API 流程。
2. 本需求不改動 draft review 頁面的主要 UX。
3. 本需求不實作批次 zip upload、影像轉檔服務或 CDN 最佳化。
4. 本需求不定義 storage vendor 細節綁死在某一家服務上；後端可自行選擇既有或最合適的 object storage。

---

## 5. Current Frontend Behavior

目前前端行為：

- `type === "existing"` 的圖片沿用既有 URL
- `type === "new"` 或 `type === "uploaded"` 的圖片持有 `File`
- `Save changes` 時，前端把 `File` 轉成 data URL，直接塞進 draft payload 的 `images` / `variations[*].images`

新流程後，前端預期行為改為：

- `type === "existing"`：直接沿用 URL
- `type === "new"` 或 `type === "uploaded"`：在 `Save changes` 時先 upload `File`
- upload 成功後把回傳 URL 寫回 payload

前端判斷哪些圖片需要 upload 的規則：

```ts
image.type !== "existing" && image.file
```

---

## 6. Functional Requirements

### FR-1 Upload timing

圖片 upload 發生在 `Save changes` 時，不是在 `Accept` 時。

原因：

- `Accept` 只代表 operator 接受預覽結果，不代表要正式儲存
- 避免產生大量未引用的垃圾檔案
- `Save changes` 才是正式提交點

### FR-2 Upload scope

upload API 必須支援以下來源：

- main images 的新上傳圖片
- main images 的 AI 修圖結果
- variation images 的新上傳圖片
- variation images 的 AI 修圖結果

### FR-3 Response contract

upload API 回傳的最重要資料是 hosted image URL，前端後續只依賴這個 URL。

### FR-4 Auth

upload API 必須與其他 admin API 一樣，要求 admin 身分驗證。

前端假設沿用既有 admin API 的 Clerk JWT header 傳遞方式，也就是沿用現有 `apiFetch()` 的 auth 行為。

目前已知：

- 這支 API 在 Go route 層未額外加 Clerk middleware
- 現有其他 admin API 在 Go 層也沒有顯式 auth middleware
- auth 很可能由既有 Vercel / infra 層處理

因此對前端來說，upload API 應視為與現有 admin API 相同的 auth 契約。

### FR-5 Validation

upload API 至少要驗證：

- 檔案存在
- MIME type 為 image/*
- 檔案大小在可接受範圍內
- 單次請求檔案數量符合限制

### FR-6 Failure behavior

若任一張 upload 失敗，前端不得繼續送 draft update API。

前端應顯示 upload 失敗訊息，draft 仍維持未儲存狀態。

---

## 7. Recommended API Design

採用單檔 upload endpoint，讓前端在 `Save changes` 時逐張或並行呼叫。

原因：

- 後端實作最簡單
- 前端 mapping 最簡單
- 降低單次 request payload 體積
- 容易觀察單張失敗原因

### 7.1 Endpoint

`POST /v1/admin/product-drafts/{draft_id}/images/upload`

### 7.2 Content-Type

`multipart/form-data`

### 7.3 Request fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | binary file | yes | image file to upload |
| `client_image_id` | string | no | frontend local image id for mapping response |
| `container` | string | no | `main` or `variation` |
| `variation_id` | string | no | optional frontend variation id for debug/logging |

### 7.4 Response

```json
{
  "url": "https://cdn.peasydeal.com/product-drafts/00bdd3b1-cff2-4ef4-aa4d-60fa27259460/1741240000-uuid.webp",
  "content_type": "image/webp",
  "size_bytes": 182304,
  "client_image_id": "img_local_123"
}
```

說明：

- `url` 為 public CDN URL，可直接用於前端預覽，也可直接寫入 draft payload
- 若 request 有帶 `client_image_id`，response 應原樣回傳，方便前端 mapping
- 前端不需要推測最終檔名或副檔名，直接使用 response `url`

### 7.5 Error response

```json
{
  "code": "DRAFT_IMAGE_MISSING_FILE",
  "error": "missing file field"
}
```

固定錯誤欄位：

- `code`: machine-readable error code
- `error`: human-readable message

已知 error codes：

- `DRAFT_IMAGE_MISSING_DRAFT_ID`
- `DRAFT_IMAGE_INVALID_FORM`
- `DRAFT_IMAGE_MISSING_FILE`
- `DRAFT_IMAGE_READ_FAILED`
- `DRAFT_IMAGE_EMPTY_FILE`
- `DRAFT_IMAGE_TOO_LARGE`
- `DRAFT_IMAGE_INVALID_MIME`
- `DRAFT_IMAGE_UPLOAD_FAILED`

建議搭配 status code：

- `400` missing draft id / invalid form / missing file / read failed / empty file / invalid mime
- `401` unauthenticated
- `403` unauthorized
- `413` file too large
- `500` storage upload failure / unexpected server error

---

## 8. Storage Requirements

後端儲存圖片時需滿足：

1. 回傳的 URL 必須可被後續 draft payload 直接使用。
2. URL 在 product draft review 與後續 publish flow 中可讀取。
3. 儲存路徑建議含 `draft_id`，方便追蹤與清理。
4. backend 自行決定最終檔名與副檔名，前端不參與 key 命名。

建議 key path 範例：

```text
product-drafts/{draft_id}/{timestamp}-{random}.{ext}
```

可選但推薦：

- 將副檔名與 content type 對齊
- 儲存 metadata：`draft_id`, uploader, upload timestamp

目前已知 backend 行為：

- 先 sniff file body 前 512 bytes 偵測 MIME type
- 再依 MIME type 決定副檔名
- `image/jpeg` -> `.jpg`
- `image/png` -> `.png`
- `image/webp` -> `.webp`
- 前端傳入的原始 filename 不影響最終 storage key

---

## 9. Frontend Integration Contract

前端在 `Save changes` 時將採用以下流程：

1. 掃描 edit state 中所有圖片
2. 對 `type !== "existing"` 且有 `file` 的圖片呼叫 upload API
3. 取得 hosted URL
4. 用 hosted URL 取代原本要塞進 payload 的 data URL
5. 呼叫既有 `PUT /v1/admin/product-drafts/{draft_id}`

也就是說，draft update API 的 `images`, `variations[*].images`, `main_image_ref.url` 最終都應是 `http(s)` hosted URL，而不是 `data:` URL。

---

## 10. Backend Constraints and Assumptions

1. 現有 `PUT /v1/admin/product-drafts/{draft_id}` 先不改 endpoint。
2. 後端 image upload API 與 draft update API 可獨立部署。
3. draft update API 不需要再支援超大 base64 image payload。
4. 若後端目前有接受 data URL 的邏輯，可先保留短期相容，但新前端不再依賴。

---

## 11. Security Requirements

1. 僅限 authenticated admin 呼叫。
2. 僅接受 image MIME type。
3. 限制單檔最大大小，避免濫用。
4. 建議限制單次儲存流程可 upload 的總檔數。
5. 建議記錄 upload audit log：
   - `draft_id`
   - `user_id`
   - filename
   - content_type
   - size_bytes
   - storage key

---

## 12. Suggested Limits

可由 backend 視實際 storage/cost 調整，但建議初始值：

- 單檔最大：`10 MB`
- 單次 `Save changes` 最多新 upload：`20` 張
- 僅允許：`image/jpeg`, `image/png`, `image/webp`

若需要更嚴格，可先設 `5 MB`。

---

## 13. Open Questions

1. storage provider 要用什麼：
   - Vercel Blob
   - S3 compatible storage
   - existing internal asset storage

2. upload 完但 draft 未成功保存的 orphan files 是否需要清理機制？

3. 是否需要在 backend 對圖片做統一轉檔或壓縮？
   - MVP 不需要
   - 若之後要做，可另開需求

---

## 14. Recommended Backend Implementation Order

1. 實作 `POST /v1/admin/product-drafts/{draft_id}/images/upload`
2. 接入 storage，回傳 hosted URL
3. 加入 auth / validation / size limits
4. 用 curl 或 Postman 驗證 upload 成功
5. 再由 frontend agent 接上 `Save changes` 流程

---

## 15. Acceptance Criteria

以下條件全部成立，視為完成：

1. 對同一個 draft，上傳一張圖片可成功取得 hosted URL。
2. 前端可在 `Save changes` 前先 upload 新圖片，再成功呼叫 draft update API。
3. draft update payload 不再包含 `data:` base64 image string。
4. 修圖後按 `Accept` 再按 `Save changes`，可成功保存 draft。
5. main images 與 variation images 都能使用同一套 upload API。
6. 非圖片檔、超過大小限制、未授權請求都會被正確拒絕。

---

## 16. Out of Scope

1. 批次 upload API
2. 直接由前端拿 presigned URL 直傳 storage
3. 自動清理未引用檔案
4. 圖片壓縮、格式轉換、背景任務優化
