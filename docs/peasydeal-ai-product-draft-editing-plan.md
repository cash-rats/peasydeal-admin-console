# AI Product Draft Editing (Operator Review)

## Goals
- Allow operators to edit draft product data before publishing.
- Prefill all editable fields from the draft payload.
- Provide a fast, low-friction image editing workflow with previews.

## Editable Fields
1. Currency
2. Price
3. Images
4. Title
5. Description

## UI/UX Design Plan

### Layout
- In `READY_FOR_REVIEW` state, replace the raw JSON card with a **two-column review panel**:
  - **Left**: “Editable Draft” form (title, description, currency, price, images).
  - **Right**: “Reject Reason” (existing) plus validation/notes.
- Keep `Publish` and `Reject` buttons in the header for quick access.

### Prefill Behavior
- On load, initialize the form state with `draft.draft` payload values.
- Provide a **“Reset to original”** action that restores the form to the last fetched payload.
- Show “Last updated” timestamp (existing UI) to reinforce data freshness.

### Field UX
- **Title**: single-line input; show optional character count.
- **Description**: multiline textarea (6–10 rows), expand on focus.
- **Currency**: compact select (ISO currency list or limited set if backend expects).
- **Price**: numeric input; allow decimals; show currency label inline.

### Image Editing UX
- Display current draft images as a **responsive thumbnail grid**.
- Each tile includes:
  - Image preview
  - “Remove” button
  - Optional badge (e.g., “Original” or “New”)
- Add a **Dropzone tile** inside the grid:
  - “Drag & drop or click to add”
  - Accepts multiple images
  - Instant preview using `URL.createObjectURL`
- Removal flow:
  - Existing image URLs are removed from the list and tracked as `removedImageUrls`.
  - Newly added images are removed from local state and object URLs revoked.
- Optional ordering UX (choose one):
  - **Simple**: New images append at the end (no reordering).
  - **Enhanced**: Add drag-to-reorder or left/right “Move” buttons.

### Save & Publish Flow
- Add a **“Save draft changes”** button (disabled unless dirty).
- Guard **Publish** when unsaved changes exist:
  - Either require save first, or
  - Pass overrides directly to the publish endpoint if supported by backend.

## Implementation Plan

### 1) Data Model
Define a local edit state that mirrors the editable payload plus image metadata.

```ts
type DraftImageItem =
  | { id: string; type: "existing"; url: string }
  | { id: string; type: "new"; file: File; previewUrl: string };

type DraftEditState = {
  title: string;
  description: string;
  currency: string;
  price: string;
  images: DraftImageItem[];
  removedImageUrls: string[];
  isDirty: boolean;
};
```

### 2) UI Changes (`src/pages/products/ai-import/show.tsx`)
- Replace the “Draft Payload” card with an `EditableDraft` component.
- Keep existing “Reject Reason” card.
- Surface validation messages near the form.

### 3) `EditableDraft` Component
- Controlled inputs backed by local state.
- Initialize state once per draft load (use `useMemo` + guarded `useEffect`).
- Track `isDirty` by comparing to initial snapshot.

### 4) Image Editor Component
- Grid layout for thumbnails + dropzone tile.
- On drop or file selection:
  - Create preview URL with `URL.createObjectURL`.
  - Push item into `images` state.
- On remove:
  - Existing image -> record in `removedImageUrls`.
  - New image -> revoke preview URL and remove from list.
- Cleanup all preview URLs on unmount.

### 5) API Integration (Backend Coordination Required)
Add an update endpoint in `src/lib/admin-ai-product-drafts.ts`:

- `PATCH /v1/product-drafts/:id` (or similar) to update payload fields.
- Proposed payload:
  - `title`, `description`, `currency`, `price`
  - `images` array of hosted URLs (after upload)

**Open question**: image upload mechanism
- If an asset upload endpoint exists, upload new files first and use returned URLs.
- If not available yet, keep upload UI but disable “Save” with a tooltip.

### 6) Publish Behavior
- If backend supports publish-with-overrides:
  - send edited payload in `publishProductDraft`.
- If not:
  - require `Save draft changes` before enabling publish.

### 7) Validation
- Required: title (non-empty)
- Price: must be numeric if provided
- Currency: optional unless backend requires

## Open Questions
1. What is the backend endpoint for saving draft edits?
2. How should new images be uploaded (existing asset service, draft-specific endpoint)?
3. Should image ordering be preserved and sent to backend?

## Out of Scope (for now)
- Full JSON editor view (can remain accessible behind an “Advanced” toggle if needed).
- Complex image cropping or editing.
