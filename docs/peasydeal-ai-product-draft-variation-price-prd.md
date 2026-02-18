# AI Product Draft — Variation Price Editable PRD

## 1) Summary
在 Admin Console 的 AI Import Product Draft 編輯頁，新增每個 variation 的 `price` 可編輯欄位，讓 operator 可調整各 variation 價格。

同時需支援舊資料相容：
- 舊 draft 可能沒有 `variations[].price`
- 當 variation price 缺失時，前端以 first-level `price` 作為預設顯示與提交值

## 2) Background
- Backend 已在 AI import product draft 新增 variation price 欄位。
- 現行 Admin Console variation 編輯欄位未包含價格，operator 無法在前台修正 variation price。
- 若不補齊 UI，會造成資料編輯能力不完整，且舊資料可能出現欄位缺失。

## 3) Goals / Non-goals

### Goals
1. 在 variation row 新增可編輯 `price` 欄位。
2. 支援 backward compatibility：舊資料無 `variations[].price` 時可正常顯示與儲存。
3. fallback 規則明確：缺失時 default 使用 first-level `price`。
4. 保持既有 save/publish 流程與 dirty-state 邏輯一致。

### Non-goals
1. 不調整後端 schema 與 API 路由。
2. 不新增複雜定價規則（例如促銷價、成本價、區間價）。
3. 不改動 variation 以外欄位的 validation 規則。

## 4) Scope
- 頁面：`/products/ai-import/:id`（draft review/edit 區塊）
- 模組：variation 編輯 UI、edit state 初始化、payload serialize

## 5) Data Contract

### Current payload (legacy compatible)
`variations[].price` 可能不存在。

```json
{
  "price": "399.00",
  "variations": [
    { "title": "Blue", "position": 0 },
    { "title": "Red", "position": 1, "price": "420.00" }
  ]
}
```

### Target payload behavior
- UI 載入時，每筆 variation 都要有可編輯價格值（顯示值）。
- 儲存時，`variations[].price` 應完整送出（即使原資料缺失）。

```json
{
  "price": "399.00",
  "variations": [
    { "title": "Blue", "position": 0, "price": "399.00" },
    { "title": "Red", "position": 1, "price": "420.00" }
  ]
}
```

## 6) Functional Requirements
1. FR-1 Variation row 顯示價格欄位
- 每個 variation row 新增 `price` input（字串型態，允許小數）。

2. FR-2 初始化 fallback
- 若 `variation.price` 為 `null/undefined/""`，初始值使用 top-level `price`。
- 若 top-level `price` 也缺失，維持空字串（避免造假資料）。

3. FR-3 編輯行為
- operator 可單獨修改各 variation price。
- 修改任一 variation price 需觸發 dirty state。

4. FR-4 儲存行為
- `toPayload` 時輸出 `variations[].price`。
- 對缺值 variation 仍輸出 fallback 後價格（若 fallback 可得）。

5. FR-5 舊資料可開啟
- legacy draft（無 variation price）可正常渲染、編輯、保存，不報錯。

## 7) UX Requirements
1. 欄位位置：放在 variation row 既有欄位（title/position）旁，維持單列可讀性。
2. 欄位標籤：`Price`（可搭配 currency 提示，例如 `Price (TWD)`）。
3. helper text（可選）：當使用 fallback 值時可顯示輕量提示，例如「Defaulted from product price」。
4. 不改動既有 publish/reject 按鈕位置與主流程。

## 8) Validation Rules
1. `variation.price` 若有值，需可被 parse 成合法數值字串。
2. 不強制 variation price 必填（由 fallback 補齊）。
3. 若 top-level price 與 variation price 都空，沿用既有表單錯誤規則（若目前未阻擋則不新增硬阻擋）。

## 9) Backward Compatibility Strategy
1. 讀取時相容：接受沒有 `variations[].price` 的 draft。
2. 顯示時相容：用 top-level `price` 做 UI default。
3. 寫回時相容：儲存 payload 時補齊 `variations[].price`，讓資料逐步升級為新格式。

## 10) Acceptance Criteria
1. 載入舊 draft（variation 無 price）時，variation price 欄位預設為 top-level price。
2. operator 可修改單一 variation price，儲存後 payload 含正確 `variations[].price`。
3. 未修改 variation price 也可儲存，且 payload 仍會帶入 fallback 值。
4. 對既有無 variations 的 draft，頁面行為不退化（無 runtime error）。
5. Save/Publish 的既有 dirty-state 與流程不被破壞。

## 11) QA Test Matrix
1. Legacy draft: `variations[].price` 全缺失 -> UI 顯示 top-level price。
2. Mixed draft: 部分 variation 有 price、部分無 -> 無者 fallback，有者保留原值。
3. Edit then save: 修改第二筆 variation price -> payload 僅該筆值變動且格式正確。
4. Empty top-level price + missing variation price -> variation price 保持空字串，不 crash。
5. Regression: variation title/position/image 編輯功能正常。

## 12) Risks and Mitigation
1. Risk: fallback 與 operator 實際意圖混淆。
- Mitigation: 可加輕提示文案，並允許 operator 直接覆寫。

2. Risk: 前端型別未同步導致 runtime/TS error。
- Mitigation: 先補齊 draft variation type，並在 normalize/toPayload 同步處理。

## 13) Implementation Notes (for next step)
1. 更新 variation edit type：加入 `price: string`。
2. 在 draft -> edit state normalize 流程加 fallback。
3. variation row UI 新增 price input。
4. `toPayload` 序列化補上 `variations[].price`。
5. 手動回歸測試上述 QA matrix。
