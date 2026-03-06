# AI Product Draft — Batch Image Editing Feasibility

## 1) Summary
Operators want to select multiple images in `products/drafts/{draft_id}` and apply the same AI edit in batch.

Supported edit modes today:
- Remove text overlay
- Replace text overlay with English
- Remove background

## 2) Verdict

### Verdict
**Feasible with moderate-to-high frontend complexity.**

This can be implemented without adding a new backend API for the MVP.

### Why it is feasible
Current implementation already has the core building blocks:
- A unified local image model for both main images and variation images
- A working single-image AI edit pipeline
- A save/publish flow that uploads edited local files later
- Helper functions that replace a specific image in local state

That means batch editing can be built as:
1. Select many images
2. Run the existing single-image edit pipeline repeatedly
3. Replace each successful result into local state
4. Reuse existing save/publish upload behavior

## 3) Current State Assessment

### 3.1 Existing image edit pipeline
Single-image editing already works like this:
1. Operator triggers one AI edit action on one image
2. Frontend fetches the image and sends it to Gemini
3. Gemini returns a processed image blob
4. Frontend converts the result to `File`
5. Frontend replaces that image in local `editState`
6. Save/Publish later uploads the edited file

Implication:
- Batch editing does not require a new storage or upload design
- It mainly needs orchestration and UX

### 3.2 Existing state model is reusable
Both main images and variation images are already represented in local React state under one editable draft model.

Implication:
- Batch selection can span both containers
- Batch replacement can stay fully client-side before save

### 3.3 Existing image card already has selection hooks
The image card component already supports:
- `isSelected`
- `onSelect`
- `interactionMode`

Implication:
- We do not need to rebuild the tile component from scratch
- We can extend the current card into a real multi-select UI

### 3.4 Existing AI preview flow is single-item only
Current confirmation dialog is designed for exactly one original image and one processed image.

Implication:
- The current preview/confirm flow does not scale directly to batch usage
- Reusing it as-is would likely create a poor operator experience

## 4) Main Challenges

### 4.1 No true multi-select model exists yet
Today the page only has:
- single selected image per variation
- no equivalent selection state for main images

This is not enough for cross-section batch editing.

We need a page-level multi-select state, likely something like:
- `Set<string>` of stable image selection keys
- key format based on `containerId + imageId`

### 4.2 Current preview-confirm UX is not batch-friendly
The existing `aiEditPreview` state only handles one image at a time.

If batch editing reused the same pattern, the operator would likely get:
- many sequential dialogs
- too much manual confirmation work
- slow and frustrating workflow

This is the biggest product/UX decision in the feature.

### 4.3 Gemini calls are inherently per-image
The current Gemini integration edits one image per request.

Implications:
- Batch means N single-image requests, not one multi-image request
- We must manage concurrency carefully
- We must expect partial success and partial failure
- Cost and rate-limit exposure increase with batch size

### 4.4 CORS and fetch failures become more visible in batch mode
The current implementation fetches image URLs directly in the browser before sending them to Gemini.

Implications:
- Any external image with restrictive CORS may fail
- In batch mode, the failure rate may be more visible
- We need better per-item error reporting than a single toast

### 4.5 Drag-and-drop and multi-select can conflict
The page already supports image drag behavior and variation row drag sorting.

Implications:
- Click-to-select can collide with click-to-preview
- Pointer interactions can collide with drag start
- Batch selection should probably use explicit checkboxes or a dedicated selection mode

## 5) Product Decision Points

Before implementation, these decisions should be confirmed:

### Decision 1: Is batch edit auto-apply or review-first?
Options:
- Auto-apply successful results immediately
- Generate results first, then let operator review before apply

Recommendation:
- **MVP: auto-apply successful results**

Reason:
- Lowest implementation risk
- Best aligned with operator speed
- Reuses current local replacement model

### Decision 2: Can selection span both main images and variation images?
Options:
- Same-container only
- Cross-container allowed

Recommendation:
- **Allow cross-container selection**

Reason:
- Operators think in terms of “all affected images”, not UI containers
- The current data model can already support this

### Decision 3: Should failed items support retry?
Options:
- No retry in first version
- Retry failed items only

Recommendation:
- **Support retry in phase 2, not MVP**

Reason:
- MVP should focus on stable batch execution and summary reporting

## 6) Recommended MVP

### MVP scope
Support:
1. Selecting multiple images
2. Applying one chosen AI edit mode to all selected images
3. Running the jobs with bounded concurrency
4. Replacing each successful result into local state
5. Reporting a batch summary with success/failure counts

Do not include in MVP:
1. Multi-image before/after approval gallery
2. Cancel in-flight jobs
3. Per-item undo/history
4. Retry-failed-only workflow
5. Mixed edit modes in one batch

### Recommended UX
Add a page-level batch action bar that appears when at least one image is selected.

Suggested controls:
- `N selected`
- `Remove text overlay`
- `Replace with English`
- `Remove background`
- `Clear selection`

Suggested selection UX:
- Add a checkbox to each image card
- Keep click-to-preview behavior separate from checkbox click
- Avoid relying on “click tile to toggle selection” as the only interaction

Suggested batch feedback:
- Show a progress indicator during batch execution
- Show a summary when complete:
  - `8 succeeded`
  - `2 failed`

## 7) Technical Design Recommendation

## 7.1 Add page-level batch selection state
Recommended shape:

```ts
type BatchImageSelectionKey = string; // `${containerId}::${imageId}`
```

Recommended state:

```ts
const [selectedImageKeys, setSelectedImageKeys] = React.useState<Set<BatchImageSelectionKey>>(
  new Set()
);
```

Notes:
- Keep this state at page level, not inside variation rows
- Clear invalid selections when draft payload refreshes or images disappear

## 7.2 Extract a batch-safe single-image processing function
Current single-image flow mixes:
- Gemini request
- preview dialog state
- local replacement concerns

Recommendation:
- Extract the pure processing logic into a reusable helper

Example shape:

```ts
async function processAiEditForImage(
  image: EditImageItem,
  mode: ImageAiEditMode,
  model: GeminiImageEditModel
): Promise<{ file: File; previewUrl: string }>
```

Then:
- Single-image flow can still use it
- Batch flow can reuse it without opening the single-image comparison dialog

## 7.3 Add batch job state
Recommended state:

```ts
type BatchEditProgress = {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  active: number;
};
```

Recommended flags:
- `isBatchEditing`
- `batchProgress`
- `batchResults`

## 7.4 Use bounded concurrency
Recommendation:
- Limit concurrency to **2 or 3** images at a time

Reason:
- Reduce browser memory spikes
- Reduce burst load on Gemini API
- Reduce chance of UI jank
- Lower risk of mass failures due to throttling

## 7.5 Apply results incrementally
When a single batch job succeeds:
1. Verify target image still exists
2. Replace only that image in `editState`
3. Update progress state

Reason:
- Better resilience if operator changes the page during processing
- Simpler than collecting everything and applying at the end

## 7.6 Failure reporting must be itemized
Current single-image toast is not enough for batch mode.

Recommendation:
- Keep a result list with:
  - image key
  - mode
  - success/failure
  - error message

This can power:
- summary UI
- future retry workflow

## 8) Risks and Mitigations

### Risk 1: Operator confusion between select / preview / drag
Mitigation:
- Add explicit checkboxes
- Keep image click for preview
- Do not overload one gesture for three actions

### Risk 2: Too many Gemini requests at once
Mitigation:
- Bound concurrency
- Disable batch controls while running
- Show active progress

### Risk 3: Partial success leads to unclear state
Mitigation:
- Show success/failure summary
- Keep failed images unchanged
- Do not block successful replacements because some items fail

### Risk 4: External image fetch failures due to CORS
Mitigation:
- Surface per-image error messages
- Consider a later server-side proxy design only if failure rate becomes material

### Risk 5: Large batch causes slow UI updates
Mitigation:
- Apply updates incrementally
- Keep non-urgent visual updates lightweight
- Consider `startTransition` for progress/result updates if rendering becomes visibly heavy

## 9) Implementation Plan

### Phase 1: MVP
1. Add page-level multi-select state
2. Add checkbox-based image selection UI
3. Add batch action bar
4. Extract reusable single-image processing helper
5. Implement bounded-concurrency batch runner
6. Replace successful images directly into local state
7. Show progress and final summary

### Phase 2: Enhancements
1. Retry failed items
2. Batch result details panel
3. Filter selection by section or status
4. Batch comparison/review experience

### Phase 3: Optional advanced workflow
1. Undo last batch
2. Save named batch presets
3. Server-side fetch/proxy if CORS issues are frequent

## 10) Effort Estimate

### MVP
- Engineering: **1.0 to 2.0 dev days**
- Manual QA/regression: **0.5 day**

### Full review-oriented version
- Engineering: **3.0 to 5.0 dev days**
- QA/regression: **1.0 day**

## 11) Recommendation
Proceed with a **batch auto-apply MVP** first.

This version has the best tradeoff:
- High operator value
- No backend contract change required
- Strong reuse of current image edit pipeline
- Lower risk than a multi-image review dialog system

If operator feedback later shows they need per-image approval, add a second-phase review workflow on top of the same batch processing foundation.
