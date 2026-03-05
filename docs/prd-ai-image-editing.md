# PRD: AI Image Editing for Product Draft Review

> **Last updated:** 2026-03-05

## Objective

Enable operators to **remove Chinese text overlays** and **remove backgrounds** from product images directly within the admin console's draft review page, using the **Gemini API**.

## Background & Context

### Why this feature exists

PeasyDeal crawls product listings from Taobao/Shopee and creates product drafts for the UK market. Crawled images often contain:

- **Chinese promotional text overlays** (e.g., 特价, 包邮, store names)
- **Cluttered backgrounds** that don't meet UK market presentation standards

Currently, operators must manually download images, edit them externally, and re-upload — a slow, error-prone process.

### What we want

A **one-click** solution in the admin console: right-click an image → "Remove Chinese Text" → get a cleaned image → confirm or discard.

---

## Technical Decisions Already Made

| Decision | Choice | Notes |
|---|---|---|
| **AI Model** | Gemini API (Nano Banana 2: `gemini-3.1-flash-image-preview`) | Tested and confirmed working. Pro model (`gemini-3-pro-image-preview`) available for higher quality. |
| **API approach** | **Frontend direct call** (no backend proxy) | Admin console is a React SPA on Vercel (static hosting). API calls run in the browser — no Vercel compute cost, no timeout. API key protected by Clerk auth + HTTP referrer restriction. |
| **Cost model** | Pay-as-you-go (~$0.01/image flash, ~$0.04/image pro) | Batch mode available at 50% discount for non-realtime |
| **UX pattern** | Right-click context menu → before/after preview → confirm | Context menu already implemented with Download action |
| **Hosting** | Both admin console and backend are on Vercel | SPA = static files only, no serverless functions needed for this feature |
| **Security** | Google API key restrictions (HTTP referrer + quota) | Key is in frontend but restricted to admin domain only. Acceptable for internal tool. |

---

## Architecture

```
┌─────────────────────────────────────────┐
│   Operator's Browser                    │
│                                         │
│   Admin Console (React SPA on Vercel)   │
│                                         │
│   Right-click image →                   │
│   • Remove Chinese Text                 │
│   • Remove Background                   │
│                                         │
│   Browser fetch() ──────────────────────┼───> Gemini API
│                                         │     gemini-3.1-flash-image-preview
│   <── processed image (base64) ─────────┼───
│                                         │
│   Before/After preview                  │
│   Accept → replace in draft editState   │
└─────────────────────────────────────────┘

Vercel: only serves static HTML/JS/CSS (zero compute cost)
```

> **Why frontend direct call?**
> - Internal admin tool (Clerk auth required) — API key exposure risk is low
> - SPA on Vercel = static hosting, no serverless functions
> - Avoids Vercel function timeout (Gemini takes 10-30s)
> - API key protected by HTTP referrer restriction
> - Simplest implementation; can move to backend later if needed

---

## Proven Prompt Templates

These prompts have been tested and produce good results:

### Remove Chinese Text
```
Remove all Chinese text, Chinese characters (中文), and promotional text overlays
from this product image. Keep the product itself completely intact.
Reconstruct the background behind the removed text naturally so it blends seamlessly.
Do not add any new text or elements.
```

### Remove Background
```
Remove the background from this product image. Keep only the product
with a clean pure white (#FFFFFF) background. Maintain the original
product size and proportions.
```

---

## Codebase Context

### Key files

| File | Role |
|---|---|
| [show.tsx](file:///Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/src/pages/products/ai-import/show.tsx) | Draft detail/review page (3100+ lines). Contains `DraggableImageCard` component with right-click `ContextMenu` (already implemented). |
| [admin-ai-product-drafts.ts](file:///Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/src/lib/admin-ai-product-drafts.ts) | API client layer for product drafts. Pattern to follow for new API functions. |
| [context-menu.tsx](file:///Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/src/components/ui/context-menu.tsx) | Shadcn/ui ContextMenu component (radix-ui based). Already imported in show.tsx. |
| [test-image-edit.py](file:///Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/scripts/test-image-edit.py) | Working Python test script for Gemini image editing. Reference for API usage patterns. |

### What's already implemented

The `DraggableImageCard` component (in `show.tsx`) already has a right-click context menu with these items:
- ✅ **Download** — downloads image as blob
- ✅ **Set as main image**
- ✅ **Preview** — opens full-size preview dialog
- ✅ **Remove** — removes image from draft

### What needs to be added

- ⬜ **"Remove Chinese Text"** context menu item → calls Gemini API → shows before/after → replaces image
- ⬜ **"Remove Background"** context menu item → same flow
- ⬜ **`aiEditImage()` utility function** → fetches image, calls Gemini REST API, returns processed Blob
- ⬜ **Before/After preview dialog** in frontend
- ⬜ **Loading state** on image card during processing

### Important code patterns

- `EditImageItem` type represents an image in the edit state (has `id`, `type`, `previewUrl`, optional `file`)
- `updateEditState()` function is used to update images in the draft
- `addImages()` / `removeImage()` functions manage image list mutations
- API functions follow the pattern in `admin-ai-product-drafts.ts`: use `apiFetch()` + `withApiBaseUrl()`
- `downloadImage()` utility (in show.tsx, line ~1078) shows how to fetch and handle image blobs
- Existing `ContextMenu` is in `DraggableImageCard` (show.tsx, ~line 1257). New AI edit items should be added here.
- The `previewImage` state + `Dialog` (show.tsx, ~line 3076) can be used as reference for the before/after dialog.

### Gemini API integration reference

**Python test script** (confirmed working): [test-image-edit.py](file:///Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/scripts/test-image-edit.py)

**TypeScript (frontend) equivalent** — this is what the actual implementation should use:

```typescript
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const MODEL = "gemini-3.1-flash-image-preview";

async function aiEditImage(imageUrl: string, prompt: string): Promise<Blob> {
  // 1. Fetch the image and convert to base64
  const imgResponse = await fetch(imageUrl);
  const imgBlob = await imgResponse.blob();
  const base64 = await blobToBase64(imgBlob);

  // 2. Call Gemini API
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: imgBlob.type, data: base64 } },
            { text: prompt },
          ],
        }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
        },
      }),
    }
  );

  // 3. Extract processed image from response
  const result = await response.json();
  const imagePart = result.candidates[0].content.parts
    .find((p: any) => p.inlineData);

  // Response returns base64-encoded image data (via REST API)
  const processedBytes = Uint8Array.from(
    atob(imagePart.inlineData.data),
    (c) => c.charCodeAt(0)
  );
  return new Blob([processedBytes], { type: imagePart.inlineData.mimeType });
}
```

> ⚠️ **Important**: When using the **Python SDK**, `part.inline_data.data` returns **raw bytes**. When using the **REST API** (fetch), `inlineData.data` returns **base64 string**. Handle accordingly.

### API Key & Billing setup

- Billing account: `01B849-8CD86B-EC361E`
- API needs a Google Cloud project linked to this billing account
- Set monthly budget ~$20 via Cloud Console budget alerts
- API key stored as `VITE_GEMINI_API_KEY` env var (Vite exposes `VITE_` prefixed vars to client)
- **Security**: Set HTTP referrer restriction on the API key in Google Cloud Console → Credentials → Edit key → Application restrictions → HTTP referrers → add `https://admin.peasydeal.com/*` and `http://localhost:5174/*`

### Testing the Gemini API

A working Python test script exists for manual testing:

```bash
/tmp/gemini-test-venv/bin/python scripts/test-image-edit.py <input-image.jpg> [output.png]
```

If the venv is gone, recreate it:
```bash
python3 -m venv /tmp/gemini-test-venv
/tmp/gemini-test-venv/bin/pip install google-genai Pillow
```

---

## UX Flow

```
Operator right-clicks image
        │
        ▼
Context menu:
  ✨ Remove Chinese Text
  🪄 Remove Background
  ─────────────────
  📥 Download
  Set as main image
  Preview
  ─────────────────
  🗑 Remove
        │
Clicks "Remove Chinese Text"
        │
        ▼
Image card shows loading spinner overlay
        │
        ▼
Gemini API returns processed image
        │
        ▼
Before/After preview dialog opens
  [Original]  ←→  [Processed]
        │
        ├─ "Accept" → replaces image in editState, marks draft as dirty
        └─ "Cancel" → discards processed image, keeps original
```

---

## Implementation Phases

### Phase 1 — MVP
- Add `VITE_GEMINI_API_KEY` env var
- Create `aiEditImage()` utility function in frontend
- Add "Remove Chinese Text" and "Remove Background" to existing context menu
- Loading spinner overlay on image card during processing
- Before/after preview dialog
- Accept → replace image in `editState` (as uploaded file type)

### Phase 2 — Enhancements
- Model selector (Flash vs Pro)
- Batch mode ("Process all images" button)
- Processing progress tracking

### Phase 3 — Polish
- Move API key to backend proxy if needed
- Undo/history
- Auto-detect images needing edits
- Cost tracking

---

## Related Documents

- [System Design](file:///Users/huangchihan/.gemini/antigravity/brain/c983f04d-b0f6-4ec6-8bd9-cb289c79f7ee/system_design_ai_image_editing.md) — Architecture diagram, API spec, cost estimation

---

## Quick Start for Next Agent

1. Read this PRD fully
2. Read `show.tsx` — focus on `DraggableImageCard` (~line 1107) and its `ContextMenu` (~line 1257)
3. Create a new file `src/lib/gemini-image-edit.ts` with the `aiEditImage()` function (see TypeScript reference above)
4. Add `VITE_GEMINI_API_KEY` to `.env.local`
5. Add "Remove Chinese Text" and "Remove Background" items to the existing `ContextMenuContent` in `DraggableImageCard`
6. Add a loading overlay state to `DraggableImageCard`
7. Create a Before/After dialog (reference the existing preview `Dialog` at ~line 3076)
8. On "Accept": convert the processed Blob into an `EditImageItem` with `type: "uploaded"` and replace the original in `editState`
9. Test at `http://localhost:5174/products/drafts/00bdd3b1-cff2-4ef4-aa4d-60fa27259460`

---

## Progress Checklist — Phase 1 MVP

> Track implementation progress here. Update status as work proceeds.

### 0. Project Setup
- [x] Create feature branch `feature/ai-image-editing`
- [ ] Add `VITE_GEMINI_API_KEY` to `.env.local`

### 1. Gemini API Utility
- [x] Create `src/lib/gemini-image-edit.ts`
  - [x] `blobToBase64()` helper
  - [x] `aiEditImage(imageUrl, prompt)` → returns `Blob`
  - [x] Export prompt constants (`PROMPT_REMOVE_CHINESE_TEXT`, `PROMPT_REMOVE_BACKGROUND`)
  - [x] Error handling (API errors, network failures, no image in response)

### 2. Context Menu — New Items
- [x] Add "✨ Remove Chinese Text" item to `DraggableImageCard` context menu
- [x] Add "🪄 Remove Background" item to `DraggableImageCard` context menu
- [x] Wire up click handlers to call `aiEditImage()`

### 3. Loading State
- [x] Add `isProcessing` state to `DraggableImageCard`
- [x] Show spinner overlay on image card while processing
- [x] Disable context menu actions during processing

### 4. Before/After Preview Dialog
- [x] Create Before/After comparison dialog component
- [x] Display original image (left) vs processed image (right)
- [x] "Accept" button → replace image in `editState` (type: `"uploaded"`)
- [x] "Cancel" button → discard processed image

### 5. Integration & Testing
- [ ] End-to-end test: right-click → Remove Chinese Text → preview → accept
- [ ] End-to-end test: right-click → Remove Background → preview → accept
- [ ] Verify replaced image persists in draft edit state
- [ ] Error state testing (invalid API key, network error)
