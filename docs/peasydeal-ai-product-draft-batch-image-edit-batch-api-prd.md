# AI Product Draft — Batch Image Editing via Gemini Batch API PRD

## 1) Summary
Enable operators to select multiple images in `products/drafts/{draft_id}` and submit a **non-blocking AI batch image edit job** powered by Gemini Batch API.

This flow is intended for:
- lower-cost batch processing
- admin-console usage where waiting is acceptable
- safer review before draft images are changed

The feature should support these edit modes:
- Remove text overlay
- Replace text overlay with English
- Remove background

## 2) Background
Current image editing flow is synchronous and single-image only:
- operator edits one image
- waits for result immediately
- reviews before/after
- applies the edited result into the draft

This works for quick one-off edits, but does not scale well when:
- many images need the same transformation
- operator time is more important than immediate turnaround
- cost efficiency matters

Gemini Batch API is a better fit for this use case because it supports asynchronous bulk processing and lower pricing than interactive requests.

## 3) Product Goal
Allow operators to:
1. select many images across main images and variation images
2. submit one batch edit job
3. continue working while the job runs asynchronously
4. return later to review results
5. apply successful outputs into the draft only after review

## 4) Non-goals
This phase does not include:
1. auto-applying results without operator review
2. auto-publishing after batch completion
3. mixed edit modes inside the same batch job
4. canceling in-flight Gemini batch jobs
5. full version history / undo stack for every applied image
6. direct frontend-to-Gemini Batch API calls

## 5) Why Batch API

### 5.1 Expected advantages
- lower model cost than synchronous interactive usage
- better fit for many-image workloads
- no need to block operator in the image detail modal

### 5.2 Operational tradeoff
Batch API is not immediate. It is a queued asynchronous workflow.

Therefore, the product experience should be designed as:
- `Select`
- `Submit job`
- `Wait`
- `Review results`
- `Apply`

not:
- `Select`
- `Wait inline`
- `Immediately replace all images`

## 6) User Stories
1. As an operator, I can select multiple draft images and submit one AI edit job.
2. As an operator, I can leave the page and come back later without losing the job.
3. As an operator, I can clearly see whether a job is queued, running, completed, or failed.
4. As an operator, I can review successful outputs before changing my draft.
5. As an operator, I can apply all successful results or only selected results.
6. As an operator, I can see which images failed and why.

## 7) Core UX Flow

### 7.1 Step 1: Select images
On the draft page:
- operator can select multiple images
- selection can span both main images and variation images
- selected count is visible in a batch action bar

Batch action bar should show:
- `N selected`
- `Remove text overlay`
- `Replace with English`
- `Remove background`
- `Clear selection`

### 7.2 Step 2: Submit batch job
When operator clicks a batch action:
- open a confirmation drawer or modal
- show selected image count
- show selected edit mode
- show chosen AI model
- explain this is asynchronous and will not immediately modify the draft

The confirm UI should include:
- selected images count
- mode summary
- cost/wait expectation text
- `Submit batch job`
- `Cancel`

### 7.3 Step 3: Job accepted
After submit:
- no draft image is replaced yet
- a new job appears in a `Batch Jobs` section on the draft page
- operator sees immediate feedback that the job was created successfully

### 7.4 Step 4: Waiting state
While the job is running, the page should show:
- job status
- created time
- last updated time
- total items
- pending / success / failed counts

Suggested status labels:
- `Queued`
- `Running`
- `Completed`
- `Completed with failures`
- `Failed`

### 7.5 Step 5: Review results
When the job finishes:
- operator can open a dedicated results view or drawer
- each item shows original image and processed result
- failed items show error details

For each successful item:
- `Apply`
- `Keep original`

Batch-level actions:
- `Apply all successful`
- `Apply selected`
- `Dismiss results`

### 7.6 Step 6: Apply results into draft
Only after operator applies results:
- successful processed images are inserted into the draft edit state
- these images then follow the existing save/publish flow

Important:
- applying a result updates the draft's local edit state
- save/publish is still a separate operator action
- batch completion itself does not mutate published data

## 8) UX Design Principles

### Principle 1: Batch job is not the same as draft mutation
The UI must clearly separate:
- `job submitted`
- `results available`
- `results applied to draft`

These are different states and should never be conflated.

### Principle 2: Operator should never wonder “did my draft already change?”
The interface should always make clear:
- before apply: draft unchanged
- after apply: draft changed locally, save still required

### Principle 3: Failures should be itemized
Batch workflows naturally produce partial failures.

The UI must show:
- how many succeeded
- how many failed
- which ones failed
- why they failed

### Principle 4: Review should be efficient
Operators should be able to:
- scan many results quickly
- bulk-apply successful outputs
- skip bad outputs without blocking the good ones

## 9) Functional Requirements

### FR-1: Multi-image selection
- Operator can select multiple images on the draft page.
- Selection works across main images and variation images.

### FR-2: Single-mode batch submission
- A batch job applies exactly one edit mode to all selected images.
- Mixed modes in one job are not allowed in this phase.

### FR-3: Asynchronous processing
- Submission creates an internal job in backend.
- Backend submits the work to Gemini Batch API.
- Frontend polls or refreshes job status from backend.
- Backend reconciles Gemini status into sqlite when job data is stale.

### FR-4: Result persistence
- Backend stores job metadata and item-level results.
- Job state must survive page reload and operator navigation.

### FR-5: Review before apply
- Completed results are not auto-applied into the draft.
- Operator must explicitly apply results.

### FR-6: Partial apply
- Operator can apply all successful results or selected successful results only.

### FR-7: Existing save/publish flow remains unchanged
- Applying results only updates editable draft state.
- Existing save and publish flows continue to handle upload and payload persistence.

## 10) Recommended UI Structure

## 10.1 Draft page additions
Add a `Batch Jobs` card or panel on `products/drafts/{draft_id}`.

Suggested columns:
- Job ID
- Mode
- Status
- Total
- Success
- Failed
- Created at
- Updated at
- Action

Suggested actions:
- `View`
- `Review`
- `Apply results`

## 10.2 Results review view
Possible implementations:
- dialog
- side drawer
- dedicated route under the draft page

Recommendation:
- **Use a dedicated results view or large drawer**

Reason:
- many-image review will not fit comfortably in a small modal
- itemized failures need room

Suggested item card content:
- original image
- processed image
- item status
- source location
  - main images
  - variation title / position
- `Apply`
- `Keep original`
- failure message if failed

## 10.3 Notifications
Use toasts for:
- job created
- apply completed
- apply failed

Use persistent UI for:
- job status
- result readiness
- partial failure details

## 11) Backend Workflow

### 11.1 Why backend-owned job orchestration
Gemini Batch API should be called from backend, not directly from frontend, because backend should own:
- API keys
- file generation
- batch job submission
- Gemini status synchronization
- output retrieval
- result normalization
- storage of processed images

### 11.2 Recommended synchronization model
Use a **frontend-driven refresh, backend-owned reconciliation** model.

This means:
- frontend polls only our backend job endpoints
- backend remains the only component that talks to Gemini Batch API
- sqlite is the source of truth for job and item status inside the admin console

This is recommended for phase 1 because it:
- avoids exposing Gemini credentials or protocol details to frontend
- avoids requiring a dedicated background worker at initial launch
- keeps the UI responsive and simple
- allows later migration to worker-based polling without changing the frontend contract

### 11.3 Proposed backend job lifecycle
1. Frontend submits selected draft image references and chosen mode.
2. Backend creates a local batch job record.
3. Backend resolves source images and generates Gemini Batch input JSONL.
4. Backend uploads input file and submits Gemini Batch job.
5. Backend stores the Gemini batch resource identifier returned on creation.
6. Frontend later requests job list or job detail from backend.
7. Backend reads sqlite job state.
8. If the job is already terminal, backend returns sqlite data directly.
9. If the job is active and sync data is stale, backend calls Gemini once to refresh status.
10. Backend writes refreshed status back to sqlite.
11. When Gemini job completes, backend downloads and parses output.
12. Backend stores successful processed assets in internal storage/CDN.
13. Backend marks each item as success or failure.
14. Frontend reads normalized results from backend.

### 11.4 Stale-sync rule
To avoid excessive Gemini polling, backend should sync external status only when:
- job status is `QUEUED` or `RUNNING`
- and `lastSyncedAt` is older than a configured threshold

Suggested threshold:
- 10 to 30 seconds

This protects against:
- overly chatty frontend polling
- duplicate refreshes from multiple tabs
- unnecessary Gemini API traffic

### 11.5 No-operator-online behavior
In this phase, if no frontend is open and no one requests job data:
- Gemini job may complete externally
- sqlite may remain temporarily stale
- status will be reconciled on the next frontend refresh

This is acceptable for phase 1 in an admin-console workflow.

If product later requires near-real-time completion updates even with no active user session, add a backend worker or scheduled reconciliation process.

### 11.6 Asset ownership requirement
Processed images should be copied into our own storage before review/apply.

Do not rely on Gemini batch output files as permanent operator-facing assets.

### 11.7 External batch identifier persistence
When Gemini Batch API accepts a batch creation request, backend should persist the external batch identifier returned by Gemini.

For product requirements, it is sufficient to treat this as:
- the external batch job handle
- the value required for later status refresh and result retrieval

Implementation detail:
- backend should store the Gemini batch resource name returned at creation time
- example format may look like `batches/{batchId}`
- exact provider response mapping belongs in backend implementation documentation, not this PRD

## 12) Proposed Internal Data Model

### 12.1 Batch job
```ts
type DraftBatchImageEditJob = {
  id: string;
  draftId: string;
  mode: "remove_text_overlay" | "replace_text_overlay_with_english" | "remove_background";
  model: string;
  status:
    | "QUEUED"
    | "RUNNING"
    | "SUCCEEDED"
    | "PARTIAL_FAILED"
    | "FAILED";
  totalCount: number;
  successCount: number;
  failureCount: number;
  externalJobId: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
};
```

### 12.2 Batch job item
```ts
type DraftBatchImageEditJobItem = {
  id: string;
  jobId: string;
  containerId: string;
  imageId: string;
  sourceImageUrl: string;
  processedImageUrl: string | null;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "APPLIED" | "DISMISSED";
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};
```

## 13) Proposed API Surface

These are internal app/backend APIs, not Gemini APIs.

### 13.1 Create job
`POST /v1/admin/product-drafts/:draftId/image-edit-batch-jobs`

Request:
```json
{
  "mode": "remove_background",
  "model": "gemini-2.5-flash-image",
  "items": [
    {
      "container_id": "main",
      "image_id": "img-1"
    },
    {
      "container_id": "variation:var-2",
      "image_id": "img-9"
    }
  ]
}
```

Response:
```json
{
  "job_id": "job_123",
  "status": "QUEUED"
}
```

### 13.2 List jobs for draft
`GET /v1/admin/product-drafts/:draftId/image-edit-batch-jobs`

Behavior:
- returns job list from sqlite
- may reconcile active job status with Gemini before returning if job data is stale

### 13.3 Get job details
`GET /v1/admin/product-drafts/:draftId/image-edit-batch-jobs/:jobId`

Behavior:
- returns job header plus item-level results
- may reconcile active job status with Gemini before returning if job data is stale

### 13.4 Apply results to draft edit state
There are two implementation options:

Option A:
- frontend fetches reviewed result URLs and inserts them into local edit state

Option B:
- backend exposes a helper endpoint that returns the reviewed images mapped to draft image references

Recommendation:
- **Option A for phase 1**

Reason:
- least backend coupling to existing draft editor state
- reuses current front-end replacement workflow

## 14) Status Model

### Job statuses
- `QUEUED`
- `RUNNING`
- `SUCCEEDED`
- `PARTIAL_FAILED`
- `FAILED`

### Item statuses
- `PENDING`
- `SUCCEEDED`
- `FAILED`
- `APPLIED`
- `DISMISSED`

### Sync policy
- Only active jobs are eligible for Gemini refresh.
- Terminal jobs should not trigger external sync.
- Backend should debounce refresh using `lastSyncedAt`.

## 15) Edge Cases
1. Operator leaves the page after submitting job.
   - Job must still complete and be visible later.
2. Draft images are manually changed before job completes.
   - Apply should verify target image still exists before replacement.
3. Some batch items fail while others succeed.
   - Good items must remain reviewable and applicable.
4. Same source image is included in multiple jobs.
   - Jobs are independent.
5. Operator applies only part of the job.
   - Applied items should be tracked separately from merely successful items.
6. Multiple tabs view the same draft.
   - Backend stale-sync rule should prevent Gemini polling on every request.
7. No operator views the page for hours.
   - sqlite status may remain stale until next refresh-triggered reconciliation.

## 16) Acceptance Criteria
1. Operator can select multiple images and submit a batch edit job.
2. Draft images do not change immediately after submission.
3. Job status persists across page refresh.
4. Completed jobs show per-item results and failures.
5. Operator can apply all successful results.
6. Operator can apply only selected successful results.
7. Applying results updates draft edit state but does not auto-save or auto-publish.
8. Existing manual save/publish flow still works after applying batch results.

## 17) Rollout Plan

### Phase 1
- batch job submission
- batch job list/status
- frontend polling of backend job endpoints
- backend syncs Gemini status on demand when sqlite state is stale
- review results
- apply all successful

### Phase 2
- background worker or scheduled reconciliation for job completion without frontend refresh
- apply selected only
- richer failure diagnostics
- retry failed items

### Phase 3
- notifications / inbox indicator when jobs complete
- cross-draft job dashboard if needed

## 18) Open Questions
1. Should completed jobs trigger an in-app notification badge for operators?
2. How long should reviewed-but-unapplied job results be retained?
3. Should one draft allow multiple active jobs at the same time?
4. Should operators be allowed to submit a new batch while another job is still running?
5. Which model should be the product default for batch mode?
6. What stale-sync interval should be used in production?

## 19) Recommendation
Proceed with a **review-first batch workflow** backed by Gemini Batch API.

This approach best balances:
- lower cost
- operator clarity
- draft safety
- future extensibility

For phase 1, use:
- frontend polling of backend job endpoints
- backend-owned Gemini reconciliation with sqlite persistence
- no direct frontend-to-Gemini status calls
- no dedicated background worker yet

It also preserves the existing mental model:
- AI generates candidates
- operator reviews
- operator decides what enters the draft

## 20) External References
- [Gemini Batch API guide](https://ai.google.dev/gemini-api/docs/batch-api)
- [Gemini Batch API reference](https://ai.google.dev/api/batch-api)
- [Gemini image generation and editing docs](https://ai.google.dev/gemini-api/docs/image-generation)
- [Gemini models page](https://ai.google.dev/gemini-api/docs/models)
