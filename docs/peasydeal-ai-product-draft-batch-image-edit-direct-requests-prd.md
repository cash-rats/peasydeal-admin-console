# AI Product Draft — Batch Image Editing via Direct Repeated Requests PRD

## 1) Summary
Enable operators to select multiple images in `products/drafts/{draft_id}` and apply the same AI image edit to all selected images by sending multiple standard Gemini image edit requests.

This approach does **not** use Gemini Batch API.

Instead, the app will:
- let operator select many images
- trigger one edit mode for the selection
- send repeated normal image edit requests with bounded concurrency
- update the draft page progressively as results return

Supported edit modes:
- Remove text overlay
- Replace text overlay with English
- Remove background

## 2) Why This Approach
This PRD describes a simpler implementation path than Gemini Batch API.

### Benefits
- much lower implementation complexity
- reuses the current single-image edit pipeline
- no job table, polling, or asynchronous batch lifecycle
- immediate operator feedback on progress and results

### Tradeoffs
- higher model cost than Gemini Batch API
- operator must keep the page open while processing
- no persistent background job if operator leaves the page

## 3) Product Goal
Allow operators to:
1. select multiple images across main images and variation images
2. run one AI edit mode against all selected images
3. watch progress in the current page
4. get partial results as they complete
5. continue with existing save/publish flow after edits are applied

## 4) Non-goals
This phase does not include:
1. Gemini Batch API integration
2. backend job queue or sqlite-persisted batch jobs
3. resumable processing after page reload
4. review results in a separate asynchronous job dashboard
5. mixed edit modes inside one batch run
6. full history or undo stack for every batch-applied image

## 5) Product Principles

### Principle 1: Keep the workflow in-page
Batch editing should feel like an extension of the current single-image edit flow, not a separate system.

### Principle 2: Make progress visible
Operators must always see:
- how many images are selected
- how many are completed
- how many succeeded
- how many failed
- whether processing is still running

### Principle 3: Preserve partial success
If some images fail, successful images should still be usable.

### Principle 4: Minimize new backend surface area
This version should rely on the existing image edit architecture as much as possible.

## 6) User Stories
1. As an operator, I can select multiple images in one draft.
2. As an operator, I can apply one AI edit mode to all selected images.
3. As an operator, I can see progress while requests are running.
4. As an operator, I can keep successful results even if some requests fail.
5. As an operator, I can save or publish the draft after batch editing completes.

## 7) Core UX Flow

### 7.1 Step 1: Select images
On the draft page:
- operator can select multiple images
- selection can span main images and variation images
- selected count is shown in a batch action bar

Batch action bar should show:
- `N selected`
- `Remove text overlay`
- `Replace with English`
- `Remove background`
- `Clear selection`

### 7.2 Step 2: Confirm batch edit
When operator clicks a batch action:
- open a small confirmation dialog or drawer
- show selected count
- show chosen edit mode
- explain that requests will run immediately in this page
- explain that leaving the page may interrupt the process

Confirm actions:
- `Start batch edit`
- `Cancel`

### 7.3 Step 3: Run requests
After confirmation:
- app starts repeated normal image edit requests
- requests are processed with bounded concurrency
- progress UI appears and remains visible during the run

### 7.4 Step 4: Update results in place
As each request succeeds:
- the target image is replaced in local draft edit state
- the image tile shows the updated result
- progress counters update

As each request fails:
- the original image remains unchanged
- the failure is tracked in the progress panel

### 7.5 Step 5: Finish
When processing completes:
- show success/failure summary
- keep successful edits applied in local state
- allow operator to save or publish using the existing flow

## 8) Recommended UX Design

## 8.1 Selection model
Use explicit checkbox selection on image cards.

Do not rely only on clicking the image tile to toggle selection because the tile already supports:
- preview
- drag behavior
- context menu

### 8.2 Batch progress panel
Display a persistent in-page panel while batch editing is running.

Suggested content:
- current mode
- total selected
- completed count
- success count
- failed count
- progress bar
- currently processing count

Suggested terminal messages:
- `Batch edit completed`
- `Batch edit completed with failures`

### 8.3 Failure visibility
At minimum, failed items should be listed with:
- image label or location
- short error message

Recommendation:
- keep a collapsible failure list inside the progress panel

### 8.4 Completion UX
When batch run finishes:
- keep the panel visible until dismissed
- show concise summary
- provide `Clear selection`

## 9) Functional Requirements

### FR-1: Multi-image selection
- Operator can select multiple images on the draft page.
- Selection works across both main and variation image sections.

### FR-2: Single-mode batch run
- One batch run applies exactly one edit mode to all selected images.
- Mixed modes in one run are not supported.

### FR-3: Bounded concurrency
- Requests should not all fire at once.
- The app should process items using a fixed concurrency limit.

Recommended initial concurrency:
- `2` or `3`

### FR-4: Incremental result application
- Successful results are applied to local edit state as they complete.
- Failed items remain unchanged.

### FR-5: Existing save/publish flow remains unchanged
- After successful batch edits, operator still uses existing save/publish actions.
- Edited images follow the current upload-on-save or upload-on-publish flow.

### FR-6: Clear completion state
- When batch run completes, app shows:
  - total attempted
  - succeeded
  - failed

## 10) Technical Approach

## 10.1 Reuse current single-image edit pipeline
Current implementation already supports:
- generating an edited image from Gemini
- converting the result into `File`
- replacing a target image in local state

This batch feature should reuse that logic instead of creating a second image processing path.

### 10.2 Extract reusable processing helper
Refactor the current single-image flow into a reusable helper that:
- takes image reference + edit mode + model
- calls Gemini
- returns processed file + preview URL

Example shape:

```ts
async function processAiEditForImage(
  image: EditImageItem,
  mode: ImageAiEditMode,
  model: GeminiImageEditModel
): Promise<{ file: File; previewUrl: string }>
```

This helper should be used by:
- existing single-image editing
- new batch editing

### 10.3 Batch runner
Implement a small in-page batch runner that:
1. receives selected images
2. runs a queue with fixed concurrency
3. updates progress after each item settles
4. applies successful results into `editState`

### 10.4 State model
Recommended page-level state:

```ts
type BatchSelectionKey = string; // `${containerId}::${imageId}`

type BatchRunState = {
  mode: ImageAiEditMode;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  active: number;
  isRunning: boolean;
  failures: Array<{
    key: string;
    label: string;
    message: string;
  }>;
};
```

Recommended additional state:
- `selectedImageKeys`
- `batchRunState`

## 10.5 Apply strategy
For this simplified version:
- successful results are auto-applied into local edit state
- no extra before/after review step for batch mode

Reason:
- much simpler than batch review workflows
- preserves the current operator expectation of fast editing
- avoids building a second-stage result management system

## 11) Backend / API Impact

### 11.1 Minimal backend impact
No new backend batch job endpoints are required for this phase.

### 11.2 Existing save/publish integration
The existing draft image upload behavior remains unchanged:
- edited images become local uploaded files in draft state
- save/publish later uploads them through the current draft image upload path

## 12) Error Handling

### 12.1 Per-item failure
If one image fails:
- keep original image unchanged
- add failure entry to batch panel
- continue processing the rest

### 12.2 Global failure
If the batch run setup itself fails:
- show a toast or alert
- do not start the run

### 12.3 Operator navigation during run
If operator reloads or leaves the page during processing:
- in-flight progress is lost
- completed local replacements already applied in memory are also lost unless already saved

This behavior is acceptable for phase 1 and should be clearly communicated in the confirmation UI.

## 13) Edge Cases
1. Operator selects images, then one image is removed before batch starts.
   - skip missing image
2. Some images fail due to CORS or fetch restrictions.
   - record failure and continue
3. Same image is selected twice through stale state.
   - deduplicate before run
4. Operator changes draft during batch run.
   - replacement should verify target image still exists before applying
5. Operator runs batch on many images.
   - concurrency limit prevents excessive burst load

## 14) Acceptance Criteria
1. Operator can select multiple images on the draft page.
2. Operator can start one batch run for a chosen edit mode.
3. App shows progress while requests are running.
4. Successful items are replaced in local draft state automatically.
5. Failed items remain unchanged and are listed in the UI.
6. Existing save/publish flow works with edited results.
7. No new backend batch job or polling system is required for this version.

## 15) Rollout Plan

### Phase 1
- multi-image selection
- batch action bar
- confirmation dialog
- bounded-concurrency request runner
- progress panel
- success/failure summary

### Phase 2
- retry failed items
- optional “apply only after final confirm” mode
- optional pause/cancel behavior

## 16) Open Questions
1. What should the default concurrency limit be in production?
2. Should the progress panel remain dismissible while the run is active?
3. Should batch mode be allowed while single-image edit dialog is open?
4. Should there be a hard maximum selected image count for MVP?

## 17) Recommendation
Proceed with this direct repeated-request approach as the first implementation of batch image editing.

It gives the best tradeoff for a first release:
- fastest delivery
- lowest architecture complexity
- maximum reuse of current code

This version can later evolve into a Gemini Batch API workflow if cost pressure becomes more important than implementation simplicity.
