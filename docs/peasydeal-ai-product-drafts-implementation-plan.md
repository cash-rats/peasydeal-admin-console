# PeasyDeal — AI Product Drafts (Refine) Frontend Implementation Plan

This document implements `docs/peasydeal-ai-product-drafts-proposal.md` as a concrete, incremental **frontend** delivery plan for the Refine admin console.

## Status Model (Updated)

Draft status values (authoritative):
`FOUND | QUEUED_FOR_DRAFT | CRAWLING | DRAFTING | READY_FOR_REVIEW | PUBLISHED | FAILED | REJECTED`

Recommended lifecycle:
`QUEUED_FOR_DRAFT → CRAWLING → DRAFTING → READY_FOR_REVIEW → (PUBLISHED | REJECTED)`

`FAILED` can occur from any in-flight state; `FOUND` is optional (if the crawler emits an early “resolved/found product” state).

---

## UX: Dedicated Page (Simplest Operator Flow)

### Route
- `/products/ai-import`

### Single-page flow (minimal steps)
1. Paste **product URL** (Shopee/Taobao) + optional hints (category, target language, vendor, tags).
2. Click **Create Draft**.
3. If URL is valid, create `product_drafts` record in **SQLite (Turso)** with `status=QUEUED_FOR_DRAFT`.
4. Backend job (RabbitMQ; already implemented) updates status as it crawls/drafts.
5. When ready (`READY_FOR_REVIEW`), show a review UI pre-filled by `draft_payload`.
6. Admin clicks **Publish** (creates product) or **Reject**.

**Design principle:** keep everything on one page; avoid wizards/modals for MVP.

---

## Frontend Delivery Plan (Turso + Polling)

Each step is designed to be independently doable and deployable. Frontend talks to backend APIs only; backend owns Turso + RabbitMQ.

### Step 1 — Align data contract (FE-visible fields)
Frontend needs, at minimum:
- `id`, `status`, `source_url`, `input_hints`, `draft_payload`, `validation_errors`, `error_message`, `created_at`, `updated_at`
- terminal metadata (if available): `published_at`, `published_product_id`, `rejected_at`, `rejected_reason`

**Deliverable:** a stable TypeScript `ProductDraft` type + status mapping used everywhere in UI.

### Step 2 — URL validation + normalization (Shopee/Taobao)
Implement a small “URL gate” on the client:
- Validate only: “looks like a URL” (`https?://` + non-empty host). Domain/path allowlist validation is backend-owned.
- UX: show clear inline errors (empty / not a URL / backend rejected).

**Deliverable:** user can’t submit empty/invalid URLs; unsupported URLs are handled by backend errors.

### Step 3 — Create draft via backend API (status=QUEUED_FOR_DRAFT)
On submit:
- Call backend `POST /v1/crawl/enqueue` with `{ url }`.
- Backend creates `product_drafts` row in Turso (`status=QUEUED_FOR_DRAFT`) and enqueues the crawl job (RabbitMQ).
- Return/display `id` (draft id) immediately and route user to the draft detail view.

**Deliverable:** one click creates a draft and shows “Queued” state.

### Step 4 — Draft details view + polling
After creation:
- Display a status timeline/progress UI for:
  `QUEUED_FOR_DRAFT / CRAWLING / DRAFTING / READY_FOR_REVIEW / (PUBLISHED|FAILED|REJECTED)`
- Poll backend `GET /v1/product-drafts/{draft_id}` (e.g. every 2–5 seconds) until terminal state.
- Handle edge cases:
  - draft not found (deleted/permission)
  - “stuck” drafts (show “Retry” CTA if supported)
  - `FAILED` (show `error_message` + link to raw extraction if allowed)

**Deliverable:** admin can watch status changes and see failure reasons.

### Step 5 — Review UI for READY_FOR_REVIEW
When `status=READY_FOR_REVIEW`:
- Render a review UI backed by `draft_payload` (read-only for MVP; optional “edit draft” later).
- Show `validation_errors` inline (field-level if possible).
- If/when edit is added: allow “save draft edits” (draft remains `READY_FOR_REVIEW` until publish/reject).

**Deliverable:** human can fix/complete the last 10% without copy/paste.

### Step 6 — Publish / Reject actions
From `READY_FOR_REVIEW`:
- **Publish**:
  - call backend publish API (e.g. `POST /v1/product-drafts/{id}/publish`)
  - on success: show `PUBLISHED` and deep-link to the created product (via `published_product_id`)
- **Reject**:
  - call backend reject API (e.g. `POST /v1/product-drafts/{id}/reject` with optional reason)
  - keep the draft in the audit trail; don’t delete by default

**Deliverable:** end-to-end operator loop: URL → READY_FOR_REVIEW → PUBLISHED/REJECTED.

### Step 7 — Admin queue/list page (optional, but useful)
Add a simple list view:
- Filter tabs: `READY_FOR_REVIEW`, `FAILED`, `PUBLISHED`, `REJECTED`
- Sort by `updated_at` descending
- Click row → opens the draft detail/review view

**Deliverable:** operators can process multiple drafts efficiently.

---

## Mock Data Strategy (UI/UX First)

To build UI/UX without blocking on backend:
- Prefer **MSW** (Mock Service Worker) to mock `POST /v1/crawl/enqueue`, `GET /v1/product-drafts/:id`, `POST /publish`, `POST /reject`.
- Use a small set of fixtures to represent each state:
  - in-flight: `QUEUED_FOR_DRAFT`, `CRAWLING`, `DRAFTING`
  - terminal: `READY_FOR_REVIEW`, `PUBLISHED`, `FAILED`, `REJECTED`
- Simulate status progression by returning different `status` values over time for the same `draft_id`.

## Acceptance Criteria (MVP)
- Admin can paste a Shopee/Taobao URL and create a draft via backend in < 2 seconds.
- Draft status updates are visible (polling) until terminal state.
- When `READY_FOR_REVIEW`, admin can review `draft_payload` and publish or reject.
- `FAILED` drafts show a useful error and are retryable if the backend supports it.

---

## Next Tasks (Backend Integration + UX Polish)

### Backend integration
- Confirm that `id` (from `POST /v1/crawl/enqueue`) is the draft id used by `GET /v1/product-drafts/{id}`.
- Implement and document the real draft endpoints (paths + request/response JSON):
  - `GET /v1/product-drafts/:id` (polling)
  - `POST /v1/product-drafts/:id/publish`
  - `POST /v1/product-drafts/:id/reject`
- Replace MSW mocks for the above endpoints with real backend calls (keep MSW for UI development only).

### UI/UX improvements (frontend-owned)
- Replace “raw JSON only” review with a minimal summary view:
  - title, primary image preview, variant count, price range, key attributes
  - keep backend validation authoritative (frontend doesn’t block publish)
- Add a drafts queue/list page (optional but recommended for operators):
  - tabs: `READY_FOR_REVIEW`, `FAILED`, `PUBLISHED`, `REJECTED`
  - click row → opens draft detail
- After publish: deep-link to the created product detail page (once route format is confirmed).

## Open Questions (to finalize sequencing and integration)

1. What are the exact backend endpoints (paths + auth) for create/poll/publish/reject?
2. Should “review” be read-only for MVP (no draft edits), or do we want “save draft edits” as well?
3. Do we need a drafts list/queue page in MVP, or only the create + detail view?
