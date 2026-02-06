# AI Product Draft Variations — UI/UX Design Plan

## Goal
Enable operators to view and edit product variations during AI Import review. Each variation supports:
- Image
- Position
- Title

Variations may be empty; in that case the product is treated as having no variations.

## Placement
- In `READY_FOR_REVIEW` → “Editable Draft” card.
- Add a new **Variations** section between **Images** and **Description** (or after Description if you prefer all media together).

## Empty State
- If `variations` is missing or empty:
  - Show muted text: “No variations. This product will be created without variants.”
  - Show a single **Add variation** button.

## Layout and Interaction
- Render a vertical list of variation rows (cards or compact rows).
- Each row contains:
  - Thumbnail preview (64–80px square). If missing image, show placeholder.
  - Image input: URL field + “Upload/Replace” button (file-to-dataURL, same as draft images).
  - Title input (single line).
  - Position input (number, small width).
  - Remove button.

## Add / Remove
- **Add variation** button at the end of the list.
- Removing a row updates the list immediately and marks the draft dirty.
- Removing the last row returns to empty state.

## Ordering
- Use `position` as the ordering mechanism.
- Optional helper text: “Lower position appears first.”
- MVP does not require drag-and-drop; positions are manual.

## Validation UX
- Light inline validation only:
  - `position` should be numeric if provided.
  - `title` optional unless backend requires it.
- Do not block publish in UI; existing “Save changes before publish” behavior remains.

## Image Handling
- Existing URLs are preserved.
- New uploads use `URL.createObjectURL` for preview and dataURL for payload.
- Revoke object URLs on remove/unmount, similar to existing image handling.

## Dirty State
- Any change to variation fields marks the draft dirty.
- Publish is disabled while unsaved changes exist (current behavior).

## Notes
- If the backend later adds an asset upload endpoint, replace dataURL conversion with upload → URL.
- If `variations` is explicitly `[]`, treat as “no variations” and display empty state.
