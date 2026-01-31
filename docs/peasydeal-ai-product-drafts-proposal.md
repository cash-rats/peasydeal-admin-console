
# PeasyDeal — “AI Product Drafts” Proposal (for Refine Admin Console)

## 1) Background

PeasyDeal’s team is small (3 people). Two time-consuming tasks are:
1) **Finding products** to list
2) **Collecting materials** (title, specs, images, variants, SEO copy) and **creating the product** in the admin console

This proposal focuses on an MVP that automates #2 heavily and sets up a foundation to help with #1 later:

> **Paste a product URL → Generate a “Product Draft” → Human review → One-click create product**

The admin console will be built with **Refine**; the draft flow integrates cleanly via Refine’s custom request hooks (`useCustomMutation`, `useCustom`) and optionally realtime updates via `liveProvider`.


---

## 2) Goals & Non-goals

### Goals (MVP)
- Create a server-side workflow that:
  - accepts a **product URL** (or supplier SKU) and optional hints
  - extracts product data (raw)
  - uses an LLM to map data into **PeasyDeal’s product schema**
  - produces a **Product Draft** object for human review/import
- Add a Refine UI entry point:
  - a page (`/products/ai-import`) or modal (“Import from URL”)
  - status/progress updates
  - review & publish → create actual product record(s)

### Non-goals (MVP)
- Fully automated publishing without review (avoid compliance/factual issues)
- Full product sourcing/trend discovery automation (can be Phase 2/3)
- Perfect extraction for every site (start with a limited allowlist + iterative improvements)


---

## 3) Admin UX (Refine Integration)

### Entry points
**Option A: Dedicated page**
- Route: `/products/ai-import`
- UI: input URL + optional hints (category, target language, margin assumptions, vendor, tags)

**Option B: Modal in Products list (nice UX)**
- “Import from URL” button opens modal form (e.g., `useModalForm` if you’re using Ant Design integration)

### How Refine integrates (updated)
- **Create Draft**: send URL + optional hints to backend API; backend creates `product_drafts` in **SQLite (Turso)** with `status=QUEUED_FOR_DRAFT` and enqueues the crawl job (RabbitMQ)
- **Poll Draft**: fetch status/details via backend API (polling is enough for MVP)
- **Publish / Reject**: once `READY_FOR_REVIEW`, admin clicks publish/reject; backend validates + executes the action


---

## 4) System Overview

### High-level flow
1) Admin submits URL
2) Backend API validates URL and creates `product_draft` in Turso (`status=QUEUED_FOR_DRAFT`) and enqueues a crawling payload
3) Backend worker processes the crawl/draft pipeline (RabbitMQ; already implemented):
   - Crawl → Draft → Validate
4) Draft becomes `READY_FOR_REVIEW`
5) Admin reviews, edits if needed, then publishes or rejects
6) On publish, API creates real `products` / `product_variants` / `product_images` entries and marks draft `PUBLISHED`

### Key design principle
**Drafts are separate from Products.**
Drafts are a staging area for automation and human QA, preventing incomplete/incorrect data from polluting production tables.


---

## 5) Data Model (SQLite / Turso-friendly)

### Table: `product_drafts`
Suggested columns:
- `id` (uuid, pk)
- `status` (enum text):
  `FOUND | QUEUED_FOR_DRAFT | CRAWLING | DRAFTING | READY_FOR_REVIEW | PUBLISHED | FAILED | REJECTED`
- `source_url` (text)
- `input_hints` (json) — user-provided hints (category, language, etc.)
- `raw_extraction` (json) — unmodified extraction result (for debugging)
- `draft_payload` (json) — normalized PeasyDeal product schema for review/import
- `validation_errors` (json)
- `error_message` (text)
- `created_by` (text / uuid) — admin user id
- `created_at`, `updated_at` (datetime)
- `published_at` (datetime)
- `published_product_id` (uuid, nullable)
- `cost` (json, optional) — token usage, extraction cost, etc.

### Table: `product_draft_events` (optional but useful)
Append-only log for auditing:
- `id`, `draft_id`
- `event_type` (STATUS_CHANGED, RETRIED, EDITED, PUBLISHED, REJECTED, FAILED)
- `payload` (json)
- `created_at`, `created_by`

### Table: `product_draft_sources` (optional)
Track evidence/citations:
- `draft_id`
- `field_path` (e.g. `variants[0].price`)
- `source_url`
- `source_snippet` (text) / `selector` (text)

This enables “show evidence” in the review UI for critical specs (dimensions, materials, etc.).


---

## 6) API Specification (MVP)

> The frontend talks to backend APIs only. Backend owns Turso writes/reads, RabbitMQ enqueue, and publish validation/side effects.

### 6.1 Create draft
**POST** `/admin/ai/product-drafts`

Request body:
```json
{
  "source_url": "https://example.com/product/123",
  "hints": {
    "language": "zh-TW",
    "category_id": 5710,
    "vendor": "example-vendor",
    "target_margin": 0.35
  }
}
```

Response:
```json
{
  "draft_id": "uuid",
  "status": "QUEUED_FOR_DRAFT"
}
```

### 6.2 Get draft (status + payload)
**GET** `/admin/ai/product-drafts/{draft_id}`

Response:
```json
{
  "draft_id": "uuid",
  "status": "READY_FOR_REVIEW",
  "source_url": "https://example.com/product/123",
  "draft_payload": { "...peasydealProductSchema..." },
  "validation_errors": [],
  "error_message": null,
  "updated_at": "2026-01-03T05:12:00Z"
}
```

### 6.3 List drafts (for admin queue)
**GET** `/admin/ai/product-drafts?status=READY_FOR_REVIEW&limit=50`

Response:
```json
{
  "items": [
    { "draft_id": "...", "status": "...", "source_url": "...", "updated_at": "..." }
  ],
  "next_cursor": null
}
```

### 6.4 Retry a failed draft
**POST** `/admin/ai/product-drafts/{draft_id}/retry`

### 6.5 Publish draft → create product
**POST** `/admin/ai/product-drafts/{draft_id}/publish`

Request:
```json
{
  "final_payload": { "...optional edited payload..." }
}
```

Response:
```json
{
  "draft_id": "uuid",
  "status": "PUBLISHED",
  "product_id": "uuid"
}
```

### 6.6 Reject draft (optional)
**POST** `/admin/ai/product-drafts/{draft_id}/reject`


---

## 7) Draft Payload Schema (Core Concept)

The `draft_payload` should match your internal product creation needs. Example shape:

```json
{
  "title": "string",
  "subtitle": "string",
  "description_html": "string",
  "bullet_points": ["string"],
  "brand": "string",
  "category_id": 123,
  "tags": ["tag1", "tag2"],
  "seo": {
    "slug": "string",
    "meta_title": "string",
    "meta_description": "string"
  },
  "attributes": {
    "material": "string",
    "dimensions": "string",
    "pet_size": ["S", "M", "L"]
  },
  "images": [
    { "url": "https://...", "alt": "string", "position": 1 }
  ],
  "variants": [
    {
      "sku": "string",
      "option_values": { "color": "Black", "size": "M" },
      "price": 499,
      "compare_at_price": 699,
      "inventory": 50,
      "weight_grams": 300
    }
  ]
}
```

### Why “Structured Outputs” matters
When generating `draft_payload` from an LLM, require the model to comply with a **JSON Schema** so responses are machine-valid and required fields aren’t omitted.


---

## 8) Job Processing Pipeline (Implementation Notes)

### Step A — Extraction
- Fetch HTML from `source_url`
- Extract:
  - title, price, variants/options, specs table, images, shipping notes, etc.
- Store as `raw_extraction` (jsonb)

**Hard requirements**
- SSRF protection (block internal IP ranges, disallow file://, etc.)
- Domain allowlist for MVP (start with 3–10 sources)

### Step B — Normalize
Map extraction output into a consistent intermediate format:
- `normalized_product`: title/specs/options/images
- include “confidence” signals if possible

### Step C — LLM Draft
- Prompt LLM with normalized data + hints
- Require response using structured outputs (JSON schema)
- Output -> `draft_payload`

### Step D — Validate
Rules:
- required fields present
- variants completeness (every variant has price, SKU or computed SKU, option values)
- image URLs valid
- category mapping valid

If validation fails:
- set `status=FAILED` or `READY_FOR_REVIEW` with warnings (choose based on severity)

### Step E — Publish/Create Product
- Transactionally create:
  - product row
  - variants
  - images (optionally: download & rehost into your CDN/R2 for reliability)
- Mark draft `PUBLISHED` & link product id


---

## 9) Refine UI Implementation Outline

### Create draft (mutation)
- Validate URL and create draft record (`status=QUEUED_FOR_DRAFT`)

### Poll draft
- Poll Turso (or `GET /admin/ai/product-drafts/{id}`) every N seconds until terminal state

### Optional realtime
- Implement `liveProvider` and broadcast draft status changes

### Modal entry point (optional)
- If using Ant Design integration, use a modal form for a smooth “Import from URL” flow


---

## 10) Security, Compliance, and Operational Considerations

- **Auth**: restrict endpoints to admin users (JWT / session)
- **Rate limiting**: per-admin + per-domain
- **Audit log**: store `product_draft_events`
- **Cost tracking**: store token usage / extraction cost in `product_drafts.cost`
- **PII**: avoid scraping pages that include personal data (generally not needed for product pages)
- **Image licensing**: ensure sources are supplier-approved or rehost only where allowed
- **Observability**: trace id per draft; log step timings; store error codes


---

## 11) Rollout Plan

### Phase 1 (MVP)
- Refine page: validate URL → create draft record in Turso → polling UI
- Backend worker: RabbitMQ crawl/draft pipeline updates statuses
- Review UI: publish or reject

### Phase 2
- Evidence/citations per field (`product_draft_sources`)
- Rehost images to your CDN/R2
- Better category auto-mapping

### Phase 3
- Product discovery automation (trend + competitor + supplier feed ingestion)
- Bulk draft creation
- A/B copy generation, localization


---

## 12) Acceptance Criteria (MVP)

- Admin can paste a URL and get a draft within ~1–3 minutes for supported domains
- Draft includes: title, description, images, at least one variant with price
- Admin can edit draft fields and publish
- Publish creates real product records without manual copy/paste
- Failed drafts are diagnosable (error message + raw extraction stored)
