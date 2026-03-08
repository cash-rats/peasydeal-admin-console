# AI Product Draft — Batch Image Edit Per-Image Revert UX PRD

## 1) Summary
Improve the current direct-request batch image editing flow so operators can keep good results and revert bad ones **per image**, without using the global draft reset.

This PRD is intended to follow the current implementation in:
- [`src/pages/products/ai-import/show.tsx`](/Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/src/pages/products/ai-import/show.tsx)

## 2) Problem
Current batch edit behavior auto-applies successful results directly into local draft state.

This creates a UX problem:
- operator batch edits 3 images
- 2 results are good
- 1 result is bad
- current `Reset` action resets the whole draft editor state

This is too destructive for the operator workflow because one bad result should not force them to discard all good results from the same batch.

## 3) Goal
Allow operators to:
1. identify which images were changed by the latest batch edit
2. revert only specific bad results
3. optionally revert all images from the latest batch run
4. keep good results without losing them through a global reset

## 4) Non-goals
This phase does not include:
1. full version history across many batch runs
2. unlimited undo stack
3. reverting edits from arbitrary historical sessions
4. backend persistence for batch revert history
5. a separate batch review route or gallery

## 5) UX Principle
The operator should be able to answer this question immediately:

`Which images were changed by the last batch run, and how do I undo only the bad ones?`

The UI should make that answer obvious without requiring the operator to use the global `Reset`.

## 6) Recommended UX

### 6.1 Rename global reset
Change the existing `Reset` button label to something explicit such as:
- `Reset all draft changes`
- or `重設整份草稿`

Reason:
- make it clear this is not “undo last batch”
- reduce accidental loss of valid edits

### 6.2 Track last batch-applied images
After a batch run completes successfully or partially successfully:
- each successfully replaced image should be marked as belonging to the latest batch session

### 6.3 Show image-level affordance on changed tiles
For images changed by the latest batch run, show clear UI on the image card:
- `Edited` badge
- `Revert` button

Optional later enhancement:
- `Before / After` preview action

### 6.4 Add summary actions in batch panel
After batch completion, the `Batch AI Edit` panel should provide:
- `Revert all from last batch`
- existing summary counts

This gives operators both:
- per-image rollback
- one-click rollback for the whole last batch

### 6.5 Keep successful images applied by default
Do not change the core direct-request flow.

The current model remains:
- successful results are applied immediately
- operator inspects results in place
- operator reverts only the bad ones

## 7) User Stories
1. As an operator, I can tell which images were changed by the latest batch run.
2. As an operator, I can revert one bad image without affecting the other successful images.
3. As an operator, I can revert the whole last batch if the run was poor overall.
4. As an operator, I can still use the existing save/publish flow after keeping only the good results.

## 8) Functional Requirements

### FR-1: Preserve per-image original value for latest batch
When a batch edit successfully replaces an image, frontend must retain enough data to restore the previous image state for that image.

### FR-2: Per-image revert
For every image changed by the latest batch run, operator can click `Revert` to restore that image only.

### FR-3: Revert all from latest batch
Operator can revert all successfully changed images from the latest batch run in one action.

### FR-4: Reset remains global
The existing reset action still resets the entire draft editor to the snapshot baseline.

### FR-5: Revert works before save/publish
Per-image revert applies to local draft edit state before save/publish.

## 9) Recommended Data Model

Add a frontend-only structure to track the latest batch session.

Example shape:

```ts
type LastBatchAppliedItem = {
  key: string; // `${containerId}::${imageId}`
  containerId: ImageContainerId;
  imageId: string;
  label: string;
  previousImage: EditImageItem;
};

type LastBatchSession = {
  mode: ImageAiEditMode;
  appliedKeys: string[];
  appliedItems: LastBatchAppliedItem[];
};
```

Notes:
- `previousImage` should be captured before replacement
- this should only track the latest batch run, not historical runs
- replacing an image again in a new batch should overwrite last-batch tracking

## 10) Technical Design

### 10.1 Capture previous image before replacement
When batch processing succeeds for a target image:
1. resolve the current image from live state
2. clone enough image metadata to restore it later
3. store that in `lastBatchSession`
4. then replace with processed image

### 10.2 Add helper to restore one image
Recommended utility:

```ts
function replaceImageWithExistingState(
  state: EditState,
  containerId: ImageContainerId,
  imageId: string,
  image: EditImageItem
): EditState
```

This should:
- replace only the matching image
- revoke object URLs only when appropriate
- preserve other images and draft state

### 10.3 Add helper to revert one image from batch session
Recommended page-level callback:

```ts
function revertLastBatchImage(key: BatchSelectionKey): void
```

Behavior:
- find stored previous image
- restore it into `editState`
- remove that item from `lastBatchSession`

### 10.4 Add helper to revert all images from latest batch
Recommended page-level callback:

```ts
function revertAllFromLastBatch(): void
```

Behavior:
- restore all stored previous images
- clear `lastBatchSession`

## 11) UX Placement

### 11.1 In image card
For any image that belongs to the latest batch-applied set:
- show a visible badge such as `Edited`
- show a compact `Revert` action

Recommended placement:
- badge near existing image metadata
- revert action near other image actions, but not hidden behind right-click only

### 11.2 In batch summary panel
When a batch run completes and there are successful edits:
- show `Revert all from last batch`
- optionally show `N images changed`

## 12) Edge Cases
1. Operator batch edits an image, then moves it between containers.
   - keying by `containerId + imageId` may no longer resolve cleanly
   - implementation should clarify whether revert support is only guaranteed before moving images
2. Operator batch edits, then removes a changed image.
   - revert should ignore missing image safely
3. Operator batch edits, then runs another batch.
   - latest batch tracking should be replaced, not merged indefinitely
4. Operator saves after partial revert.
   - resulting saved payload should reflect the mixed keep/revert state

## 13) Acceptance Criteria
1. After a batch run, changed images are visually distinguishable from unchanged images.
2. Operator can revert one changed image without affecting others.
3. Operator can revert all images changed by the latest batch run.
4. Global draft reset remains available and clearly labeled as a full reset.
5. Saving after partial revert preserves only the images the operator kept.

## 14) Implementation Plan

### Phase 1
1. Rename global reset button to clarify full-draft scope
2. Add latest-batch tracking state
3. Capture previous image data before batch replacement
4. Add per-image revert action
5. Add `Revert all from last batch` in batch panel

### Phase 2
1. Add optional before/after preview for batch-edited tiles
2. Add richer “changed by latest batch” filtering or highlighting

## 15) Recommendation
Implement this as the next step after the current direct-request batch MVP.

It solves the most important operator trust issue without forcing the product into a heavier review workflow.

This gives a strong middle ground:
- keep the simple direct-request batch architecture
- avoid destructive global reset behavior
- let operators keep the 2 good images and discard the 1 bad image

## 16) Implementation Checklist

### 16.1 Branch and scope
- [x] Create feature branch: `codex/ai-batch-image-revert-ux`
- [x] Keep scope limited to latest batch only (no multi-run history, no undo stack)

### 16.2 State model
- [x] Add `LastBatchSession` and `LastBatchAppliedItem` types in `show.tsx` (or a nearby types module)
- [x] Add `lastBatchSession` page state with empty initial value
- [x] Use a stable key format: `${containerId}::${imageId}`

### 16.3 Batch apply flow changes
- [x] At batch run start, replace old `lastBatchSession` with a new run-scoped session
- [x] Before each successful replacement, capture the current image as `previousImage`
- [x] After replacement success, append item and key into `lastBatchSession`
- [x] Do not add failed targets into `lastBatchSession`

### 16.4 Revert helpers
- [x] Implement `replaceImageWithExistingState(state, containerId, imageId, image)`
- [x] Implement `revertLastBatchImage(key)` and remove only that reverted item from session
- [x] Implement `revertAllFromLastBatch()` and clear session after restore
- [x] Ensure missing/moved/deleted image targets are ignored safely (no throw)

### 16.5 UI changes
- [x] Rename global `Reset` to `Reset all draft changes` (or `重設整份草稿`)
- [x] Show `Edited` badge on images changed by the latest batch session
- [x] Add per-image `Revert` action on changed image cards
- [x] Add batch panel action: `Revert all from last batch`
- [x] Show summary count in batch panel (for example: `N images changed`)

### 16.6 Interaction rules
- [x] Re-running batch should overwrite latest-batch tracking, not merge indefinitely
- [x] Per-image revert must not affect other successfully edited images
- [x] Revert-all should only affect images from the latest batch session
- [x] Global reset behavior remains full-draft reset

### 16.7 Verification checklist
- [ ] Partial-success run: edit 3 images, revert 1 bad, keep 2 good
- [ ] Revert-all after partial-success run
- [ ] Save after partial revert persists the mixed keep/revert result
- [ ] Remove or move an edited image, then trigger revert (must degrade safely)
- [ ] Run a second batch and confirm latest-session overwrite behavior

### 16.8 Optional phase-2 follow-ups
- [ ] Add `Before / After` preview for edited image cards
- [ ] Add filtering/highlight mode for "changed by latest batch"
