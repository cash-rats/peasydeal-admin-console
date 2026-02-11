# AI Product Draft — Images / Variation Images Cross-DnD PRD

## 1) Summary
Enable operators to **move images between the main `images` section and each `variation.images` section via drag-and-drop**.

This feature is a **move operation** (not copy):
- Drag from `variation.images` to main `images` => source variation loses one image, main images gains one image.
- Drag from main `images` to a target variation => main images loses one image, target variation gains one image.

## 2) Feasibility Assessment

### Verdict
**Feasible with moderate implementation complexity** in current codebase.

### Why it is feasible
Current implementation already uses a unified image item type in edit state:
- `EditImageItem` is used by both main images and variation images.
- Both containers are local React state in `/src/pages/products/ai-import/show.tsx`.
- Save path already serializes from state to payload (`toPayload`) for both `images` and `variations[].images`.

Therefore, cross-container transfer can be implemented as state move operations without backend contract changes.

### Main technical challenge
The page already has variation-row drag sorting (`DndContext` + `SortableContext`).
Cross-image transfer adds another drag behavior and can conflict with existing drag sensors.

### Recommended approach
Use a **single top-level DnD orchestration** that supports multiple drag types:
- `variation_row` (existing reorder)
- `image_item` (new cross-container move)

Branch logic in `onDragEnd` by draggable type + source/target container metadata.

## 3) Goals and Non-goals

### Goals
1. Support dragging image cards from any variation to main images.
2. Support dragging image cards from main images to a specific variation image container.
3. Preserve existing metadata on moved image items (`type`, `url`, `file`, `previewUrl`).
4. Keep dirty-state/save/publish behavior unchanged.

### Non-goals (this phase)
1. Copy-on-drag (e.g., modifier key copy).
2. Cross-variation direct move (variation A -> variation B) unless piggybacked by generic container move logic.
3. Image ordering persistence across backend fields beyond current array order semantics.
4. Touch-specific advanced gestures beyond standard pointer support.

## 4) User Stories
1. As an operator, I can move a variation image to main images by drag-and-drop.
2. As an operator, I can move a main image into a chosen variation by drag-and-drop.
3. As an operator, I immediately see the item removed from source and added to target.
4. As an operator, I can still save and publish with existing workflow.

## 5) Functional Requirements

### FR-1: Variation -> Main transfer
- When an image tile from `variation.images` is dropped on main `images` drop zone:
  - remove image from source variation list
  - append image to main images list
  - mark form dirty

### FR-2: Main -> Variation transfer
- When an image tile from main `images` is dropped on a variation image container:
  - remove image from main images list
  - append image to target variation list
  - mark form dirty

### FR-3: Move semantics
- The operation must move the same image item object semantics (no data loss).
- No object URL revocation on move.
- Object URL revocation should still happen only on actual deletion/unmount.

### FR-4: Invalid drop behavior
- If dropped outside valid targets, source/target remain unchanged.

### FR-5: Existing features remain working
- Variation row drag sorting remains available.
- Upload, remove, URL edit remain available for both sections.
- Save/publish/reject flows remain unchanged.

## 6) UX / Interaction Design

### Drag affordances
- Each image card shows draggable cursor/feedback.
- Main images grid and each variation image grid provide visible drop highlight during drag-over.

### Drop targets
- Main images container is a valid drop target for any variation image.
- Each variation image container is a valid drop target for main images.

### Feedback
- While dragging: active card opacity + target highlight.
- On successful drop: immediate state update with no modal.

## 7) Technical Design

## 7.1 Data model (no API change)
Continue using:
- `EditState.images: EditImageItem[]`
- `EditState.variations[].images: EditImageItem[]`

No backend contract change:
- still save as `images[]` and `variations[].images[]`.

## 7.2 DnD model
Attach dnd metadata to draggable image tiles:
- `dragType: "image_item"`
- `sourceContainer: "main" | "variation:<variationId>"`
- `imageId`

Attach droppable metadata to containers:
- main images container: `targetContainer: "main"`
- variation container: `targetContainer: "variation:<variationId>"`

`onDragEnd` rules:
1. Resolve source container and target container.
2. If identical or invalid target: no-op.
3. Remove from source list.
4. Append to target list.

## 7.3 Coexist with variation sorting
Two options:
1. Preferred: single orchestration with typed drag data (`variation_row` vs `image_item`) and one `onDragEnd` router.
2. Fallback: isolate variation sorting to drag handle and use separate context for image transfer only if event boundaries are guaranteed.

Recommendation: **Option 1** for predictable behavior and less gesture collision.

## 7.4 State utility functions to add
- `moveImageVariationToMain(state, variationId, imageId)`
- `moveImageMainToVariation(state, imageId, variationId)`
- (optional generic) `moveImageBetweenContainers(state, source, target, imageId)`

These should be pure state transforms and reused by dnd handler.

## 8) Edge Cases
1. Source item not found (stale drag) => no-op.
2. Target variation removed during drag => no-op.
3. Empty target list => item becomes first element.
4. Dragging `new` image (`file + previewUrl`) across containers => keep same object metadata.
5. Dropping onto nested controls (URL input/remove button) should not trigger move unless container target is valid.

## 9) Acceptance Criteria
1. Dragging variation image to main images moves exactly one item.
2. Dragging main image to any variation moves exactly one item.
3. Source count decrements by 1 and target count increments by 1 after each successful move.
4. Save request payload reflects new location in `images[]` / `variations[].images[]`.
5. Variation row reorder remains functional after this change.
6. No TypeScript errors, no runtime crashes in review page flow.

## 10) QA Plan
1. Manual test matrix:
- existing URL image main -> variation
- uploaded (new) image main -> variation
- variation -> main for existing/new
- invalid drop outside targets
- after move + save + reload
2. Regression checks:
- variation reorder drag handle
- image remove/upload/url edit
- publish disabled on dirty remains intact

## 11) Effort Estimate
- Engineering: **1.0 ~ 1.5 dev days**
- QA/manual verification: **0.5 day**

## 12) Rollout and Risk

### Risks
1. Drag gesture conflicts between variation row sorting and image transfer.
2. Visual drop targets unclear causing operator confusion.

### Mitigations
1. Restrict row sorting to explicit handle (`GripVertical`) and tag drag types.
2. Add clear hover/active target styles.
3. Add unit-like utility tests for move functions (if test harness available) or strict manual regression checklist.
