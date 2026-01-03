# PeasyDeal — AI Product Drafts (Refine) Implementation Plan

This document implements `docs/peasydeal-ai-product-drafts-proposal.md` as a concrete, incremental delivery plan for the Refine admin console.

## Recommendation: Orchestration (n8n vs Inngest)

### Use Inngest for the core pipeline (recommended for MVP)
- Code-first workflow orchestration that lives with the repo.
- Clear step boundaries matching the proposal statuses:
  `QUEUED → EXTRACTING → DRAFTING → VALIDATING → READY_FOR_REVIEW` (+ terminal: `APPROVED | FAILED | CANCELLED`).
- Retries/backoff, idempotency, concurrency limits, and step-level observability.
- Easier to enforce SSRF protection, allowlists, and auth consistently in code.

### “Series of agents” approach
If you want a “multi-agent” design, keep it simple: implement each stage as a dedicated Inngest step/function (extractor/normalizer/drafter/validator). Inngest becomes the orchestrator; “agents” are just well-bounded steps with strong contracts and persistence.

### Use n8n only for optional integrations (post-MVP)
- Helpful when a non-dev needs to adjust connectors/workflows.
- Best suited for “side workflows” (Slack notifications, Sheets export, vendor-specific connectors), not the core product creation path.

**MVP choice:** Inngest for the AI draft pipeline; keep n8n out of the critical path.

---

## UX: Dedicated Page (Simplest Operator Flow)

### Route
- `/products/ai-import`

### Single-page flow (minimal steps)
1. Paste **product URL** (or supplier SKU later) + optional hints (category, target language, margin assumptions, vendor, tags).
2. Click **Generate Draft**.
3. See **progress + status** (`QUEUED/EXTRACTING/DRAFTING/VALIDATING`).
4. When ready (`READY_FOR_REVIEW`), see a **review form pre-filled by AI** (only required fields up front).
5. Click **Approve & Create Product**.
6. Redirect to the created product page (edit/show) for final tweaks.

**Design principle:** keep everything on one page; avoid wizards/modals for MVP.

---

## Delivery Plan: Break the Feature into Small, Shippable Steps

Each step is designed to be independently doable and deployable.

### Step 1 — Drafts storage + API skeleton (no AI yet)
- Create `product_drafts` table using the proposal’s suggested columns:
  - required: `id`, `status`, `source_url`, `input_hints`, `raw_extraction`, `draft_payload`, `validation_errors`, `error_message`, `created_by`, `created_at/updated_at`, `approved_at`, `approved_product_id`
  - optional: `cost` (token usage/extraction cost)
- Implement endpoints from the proposal (can be stubbed initially):
  - `POST /admin/ai/product-drafts` (create)
  - `GET /admin/ai/product-drafts/{draft_id}` (status + payload)
  - `GET /admin/ai/product-drafts?status=READY_FOR_REVIEW&limit=50` (admin queue list)
  - `POST /admin/ai/product-drafts/{draft_id}/approve` (approve/create)
  - `POST /admin/ai/product-drafts/{draft_id}/retry` (retry failed)
  - `POST /admin/ai/product-drafts/{draft_id}/cancel` (cancel running)

**Deliverable:** end-to-end “create draft + poll status” works even with fake data.

### Step 2 — Refine page MVP (polling + basic display)
- Add `/products/ai-import` page:
  - URL input + “Generate Draft”
  - Poll draft status every N seconds via `useCustom`
  - Display status + raw `draft_payload` (temporary JSON viewer is fine)

**Deliverable:** UI can drive the flow and show progress.

### Step 3 — Background job infrastructure (Inngest)
- On draft creation, trigger an Inngest function/event.
- Implement step skeleton that updates `product_drafts.status`.
- Add guardrails immediately:
  - domain allowlist for MVP (start with 3–10 sources)
  - SSRF protection (block internal IP ranges, disallow file://, etc.)
  - fetch timeout + max HTML size

**Deliverable:** real async processing path exists; still can emit placeholder payload.

### Step 4 — Extraction (deterministic, diagnosable)
- Fetch HTML from `source_url` and extract the proposal’s suggested fields (title, price, variants/options, specs table, images, shipping notes where relevant).
- Store unmodified result to `raw_extraction` for debugging.
- Fail clearly (`status=FAILED`) with an actionable `error_message` when unsupported.

**Deliverable:** “supported site” URLs consistently produce structured extraction output.

### Step 5 — Normalize + Validate (still no LLM required)
- Normalize extraction into a stable intermediate shape (e.g. `normalized_product`).
- Validate minimum completeness (e.g. title + at least 1 image + at least 1 variant candidate).

**Deliverable:** stable contract for the LLM step; fewer prompt surprises.

### Step 6 — LLM Drafting (structured output + business validation)
- Define a JSON Schema for `draft_payload` (matching the proposal’s “Draft Payload Schema” shape: title/description/images/variants/seo/attributes/etc.).
- Prompt with `normalized_product` + hints; require structured output.
- Validate:
  - schema validity
  - required business rules from the proposal (variants completeness, image URLs valid, category mapping valid)
- Set `READY_FOR_REVIEW`; if validation fails, choose:
  - `FAILED` for hard failures
  - `READY_FOR_REVIEW` with `validation_errors` for warnings where a human can fix quickly

**Deliverable:** draft becomes human-reviewable with minimal manual filling.

### Step 7 — Review UI (minimum human effort)
- Replace JSON viewer with a compact review form prioritizing required fields:
  - title, category, images, variants (sku/options/price)
  - optional: description_html, bullets, SEO
- Highlight missing/invalid fields; keep edit friction low.

**Deliverable:** human can “fix the last 10%” quickly.

### Step 8 — Approve → Create actual product records
- Implement transactional create:
  - `products`
  - `product_variants`
  - `product_images`
- Update draft:
  - `status=APPROVED`, `approved_product_id`, `approved_at`
- Redirect to created product in Refine.

**Deliverable:** one-click import into real product tables works.

### Step 9 — Operational hardening (post-MVP but important)
- Retry: `POST /admin/ai/product-drafts/:id/retry`
- Cancel: `POST /admin/ai/product-drafts/:id/cancel`
- Auth: restrict all endpoints to admin users (JWT/session).
- Rate limiting per admin + per domain; concurrency caps in Inngest.
- Observability: trace id per draft; log step timings; store error codes.
- Optional audit log table `product_draft_events` for status changes/retries/approvals.
- Optional “evidence/citations” table `product_draft_sources` (Phase 2).
- Optional: realtime updates via `liveProvider` (replace polling).

---

## Rollout alignment (proposal phases)

### Phase 1 (MVP)
- Steps 1–8, with polling-based UI and a limited source allowlist.

### Phase 2
- Add `product_draft_sources` evidence and optional image rehosting to CDN/R2.
- Improve category auto-mapping.

### Phase 3
- Product discovery automation, bulk draft creation, A/B copy generation/localization.

---

## Acceptance Criteria (MVP)
- Draft generation returns within ~1–3 minutes for supported domains.
- Draft includes: title, description, images, and at least one priced variant.
- Admin can edit draft fields and approve.
- Approve creates real product records without manual copy/paste.
- Failed drafts are diagnosable (`error_message` + `raw_extraction` stored).

---

## Open Questions (to finalize sequencing and integration)

1. Where will the endpoints + Inngest functions run (Vercel/Next API routes, Go service, etc.)?
2. How do you currently create products (existing resource/dataProvider), and what are the minimum required fields?
3. Which domains should be on the MVP allowlist (3–10 sources)?
