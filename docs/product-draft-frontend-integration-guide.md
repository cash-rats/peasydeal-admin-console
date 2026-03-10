# Product Draft Frontend Integration Guide

This document is for frontend agents integrating the admin product draft APIs after the multi-environment publish changes.

Related backend references:
- `docs/admin-apis.md` (may live outside this repo snapshot)
- `docs/product-draft-multi-environment-publish-plan.md` (may live outside this repo snapshot)

## System Model Clarification

A product draft is a single shared draft record stored in one SQLite-backed draft system.

`staging` and `production` are publish targets of that same draft record. They are not:
- separate draft records
- separate draft detail endpoints
- separate sources of draft truth for the frontend

This means:
- the frontend reads one draft record from the admin draft API
- that draft may contain both `publish_state.staging` and `publish_state.production`
- the same draft can be published to `staging` first and later to `production`
- frontend must model `target` as publish intent, not as draft data source selection

Important distinction:
- `API environment` means which admin backend the frontend is talking to
- `publish target` means which downstream publish destination the draft is being published to

For this integration, frontend behavior must follow the draft API contract and treat `target`, `publish_state`, and `publish_state_summary` as the source of truth. Do not model this feature as runtime environment switching.

## Goal

Frontend should support:
- showing draft publish state for `staging` and `production`
- publishing a draft to either environment
- editing draft content without touching backend-managed publish fields
- deleting drafts with the new production-aware guard

## Environments

`staging` and `production` are two publish targets for the same draft record.

Rules:
- a draft can be published to `staging` first
- later, the same draft can still be published to `production`
- `production` publish is the terminal business publish state
- staging-only published drafts are still deletable

Frontend should treat `target` as explicit user intent.
Even though publish defaults to `production` when omitted, frontend should always send `target`.

## Backward Compatibility

Legacy detail response fields still exist:
- `published_at_ms`
- `published_product_id`

Compatibility rule:
- they mirror production publish data only
- they do not represent staging publish state

Frontend rule:
- new UI must read `publish_state.production`
- do not build new UI logic on top of `published_at_ms` or `published_product_id`
- keep accepting those fields in response models only if older shared code still expects them

## Status Interpretation

Top-level draft `status` is not the source of truth for per-target publish UI.

Frontend rules:
- list CTA and publish badges must use `publish_state_summary`
- detail publish sections must use `publish_state`
- delete guard must use `publish_state.production.status`
- legacy fields `published_at_ms` and `published_product_id` mirror production only and must not be used for new UI logic

## API Summary

### 1. List drafts

`GET /v1/admin/product-drafts`

Use this for list page rows and CTA state.

Relevant response shape:

```json
{
  "items": [
    {
      "id": "draft_1",
      "status": "READY_FOR_REVIEW",
      "url": "https://source-url",
      "thumbnail_url": "https://...",
      "updated_at_ms": 1760000000000,
      "publish_state_summary": {
        "staging": { "status": "NOT_PUBLISHED" },
        "production": { "status": "PUBLISHED" }
      }
    }
  ],
  "next_cursor": "..."
}
```

### 2. Get draft detail

`GET /v1/admin/product-drafts/{id}`

Use this for the detail page and final source of truth for publish metadata.

Relevant response shape:

```json
{
  "id": "draft_1",
  "status": "READY_FOR_REVIEW",
  "draft": {},
  "publish_state": {
    "staging": {
      "status": "PUBLISHED",
      "product_id": "123",
      "product_uuid": "uuid-stg",
      "published_at_ms": 1760000000000,
      "error": null
    },
    "production": {
      "status": "FAILED",
      "product_id": null,
      "product_uuid": null,
      "published_at_ms": null,
      "error": "failed to upsert algolia document"
    }
  }
}
```

### 3. Update draft

`PUT /v1/admin/product-drafts/{id}`

Use this only for editable draft content.

Do not send:
- `publish_state`
- any `staging_*` field
- any `production_*` field
- `published_at_ms`
- `published_product_id`

These are backend-managed and read-only.

### 4. Delete draft

`DELETE /v1/admin/product-drafts/{id}`

Delete is blocked only when production publish state is already `PUBLISHED`.

Behavior:
- production published: delete should be disabled or rejected
- staging-only published: delete is allowed
- delete does not clean up already-published staging artifacts

### 5. Publish draft

`POST /v1/admin/product-drafts/{id}/publish`

Frontend should always send `target`.

Example:

```json
{
  "draft_id": "draft_1",
  "target": "staging",
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
  "variations": [],
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

Success response:

```json
{
  "ok": true,
  "draft_id": "draft_1",
  "target": "staging",
  "product_id": 12345,
  "product_uuid": "uuid",
  "published_at_ms": 1760000000000,
  "idempotent_reused": false,
  "publish_state": {
    "staging": { "status": "PUBLISHED" },
    "production": { "status": "NOT_PUBLISHED" }
  }
}
```

## Suggested TypeScript Types

```ts
export type PublishTarget = "staging" | "production";

export type PublishStateStatus =
  | "NOT_PUBLISHED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED";

export type PublishState = {
  status: PublishStateStatus;
  product_id: string | null;
  product_uuid: string | null;
  published_at_ms: number | null;
  error: string | null;
};

export type PublishStateCollection = {
  staging: PublishState;
  production: PublishState;
};

export type ProductDraftListItem = {
  id: string;
  status: string;
  url: string | null;
  thumbnail_url: string | null;
  updated_at_ms: number;
  publish_state_summary: {
    staging: { status: PublishStateStatus };
    production: { status: PublishStateStatus };
  };
};

export type ProductDraftDetail = {
  id: string;
  status: string;
  draft: Record<string, unknown>;
  error: string | null;
  created_by: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  published_at_ms: number | null;
  published_product_id: string | null;
  publish_state: PublishStateCollection;
};

export type PublishDraftResponse = {
  ok: true;
  draft_id: string;
  target: PublishTarget;
  product_id: number;
  product_uuid: string;
  published_at_ms: number;
  idempotent_reused: boolean;
  publish_state: PublishStateCollection;
};
```

## UI Rules

### Draft list page

Use `publish_state_summary` to render per-environment CTA:
- `NOT_PUBLISHED`: show publish button
- `FAILED`: show retry button and failure hint
- `PUBLISHED`: show published badge
- `PUBLISHING`: show loading/disabled state if backend starts using it later

Do not rely only on top-level draft `status` for publish CTA.

### Draft detail page

Use `publish_state` as the source of truth.

Recommended sections:
- `Staging publish`
- `Production publish`

Each section should show:
- current status
- published time if present
- `product_id` and `product_uuid` if present
- error message if present
- publish / retry button

### Delete button

Disable delete when:
- `publish_state.production.status === "PUBLISHED"`

Do not disable delete just because staging is published.

### Edit form

Editable fields come from `draft`.
Do not expose publish metadata in editable form state.

When building update payload:
- send only editable draft fields plus top-level `status`
- never round-trip backend-managed publish fields back into `PUT`

## Publish Flow Recommendation

### On button click

1. Load current detail if the page only has list summary data.
2. Build publish payload from editable draft data.
3. Set `target` from the clicked button.
4. Call `POST /publish`.
5. Replace local publish state with response `publish_state`.
6. Re-fetch detail if the page depends on other computed backend fields.

### Idempotency

Publish may return `idempotent_reused = true`.

Frontend should treat this as success.
Do not show it as an error.

Recommended copy:
- `Already published to staging`
- `Already published to production`

## Error Handling

Useful publish errors:
- `DRAFT_NOT_FOUND`
- `DRAFT_STATUS_INVALID`
- `DRAFT_TARGET_ALREADY_PUBLISHED`
- `PUBLISH_GATE_FAILED`
- `PG_INSERT_FAILED`
- `ALGOLIA_INDEX_FAILED`
- `PUBLISH_POST_COMMIT_SYNC_FAILED`

Recommended behavior:
- `4xx`: show inline actionable validation or business rule message
- `5xx`: show generic failure toast and keep the returned `publish_state.error` if available after refresh

For update:
- if response is `"<field> is read-only"`, frontend should remove that field from the payload builder

For delete:
- if response is `"cannot delete a published draft"`, refresh detail and lock the delete UI

## Frontend Implementation Checklist

- add `PublishTarget` and `PublishStateStatus` types
- add `publish_state_summary` to list item model
- add `publish_state` to detail model
- render separate staging and production status blocks
- always send explicit `target` on publish
- keep publish metadata out of update payloads
- disable delete only for production-published drafts
- treat `idempotent_reused` as success
- after publish, update UI from response `publish_state`

## Implementation Boundary

Frontend should treat publish metadata as backend-managed, read-only state.

Frontend must:
- send explicit `target` on every publish request
- keep publish metadata out of update payloads
- update local UI from response `publish_state`
- treat `idempotent_reused = true` as a successful publish outcome

Frontend must not:
- infer staging/production state from top-level draft status alone
- use legacy production mirror fields as new UI state
- model staging and production as separate draft records
- block delete only because staging is published

## Non-Goals / Current Limitations

- delete does not unpublish or clean external staging artifacts
- old fields `published_at_ms` and `published_product_id` still exist for compatibility and mirror production only
- backend defines `PUBLISHING`, but current flow mainly returns `NOT_PUBLISHED`, `FAILED`, and `PUBLISHED`
