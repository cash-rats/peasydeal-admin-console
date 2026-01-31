import { http, HttpResponse } from "msw";

import type { ProductDraft, ProductDraftStatus } from "./types";

type StoredDraft = Omit<ProductDraft, "draft_id"> & { id: string };

const drafts = new Map<string, StoredDraft>();

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `draft_${Math.random().toString(16).slice(2)}`;
}

function computeStatus(draft: StoredDraft): ProductDraftStatus {
  if (draft.status === "PUBLISHED" || draft.status === "FAILED") return draft.status;
  if (draft.status === "REJECTED") return draft.status;

  const elapsedMs = Date.now() - new Date(draft.created_at).getTime();
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));

  if (draft.source_url.includes("fail") && elapsedSeconds >= 4) {
    return "FAILED";
  }

  if (elapsedSeconds < 2) return "QUEUED_FOR_DRAFT";
  if (elapsedSeconds < 5) return "CRAWLING";
  if (elapsedSeconds < 8) return "DRAFTING";
  return "READY_FOR_REVIEW";
}

function ensurePayload(draft: StoredDraft): StoredDraft {
  if (draft.draft_payload) return draft;

  return {
    ...draft,
    draft_payload: {
      title: "Mock Product Title",
      brand: "Mock Brand",
      description_html: "<p>Mock description generated from the supplier page.</p>",
      images: [
        {
          url: "https://picsum.photos/seed/peasydeal/640/640",
          alt: "Mock image",
          position: 1,
        },
      ],
      variants: [
        {
          sku: "MOCK-SKU-001",
          option_values: { color: "Black", size: "M" },
          price: 499,
          compare_at_price: 699,
          inventory: 50,
          weight_grams: 300,
        },
      ],
      seo: {
        slug: "mock-product-title",
        meta_title: "Mock Product Title",
        meta_description: "Mock meta description.",
      },
    },
    validation_errors: [],
  };
}

function toApiShape(draft: StoredDraft): ProductDraft {
  const {
    id: draft_id,
    status,
    source_url,
    input_hints,
    draft_payload,
    validation_errors,
    error_message,
    created_at,
    updated_at,
    published_at,
    published_product_id,
    rejected_at,
    rejected_reason,
  } = draft;

  return {
    draft_id,
    status,
    source_url,
    input_hints,
    draft_payload,
    validation_errors,
    error_message,
    created_at,
    updated_at,
    published_at,
    published_product_id,
    rejected_at,
    rejected_reason,
  };
}

export const handlers = [
  http.post("*/api/crawl/enqueue", async ({ request }) => {
    const body = (await request.json().catch(() => null)) as
      | { url?: string }
      | null;

    const url = body?.url?.trim();
    if (!url) {
      return HttpResponse.json({ message: "url is required" }, { status: 400 });
    }

    const id = newId();
    const created_at = nowIso();

    const draft: StoredDraft = {
      id,
      status: "QUEUED_FOR_DRAFT",
      source_url: url,
      input_hints: null,
      draft_payload: null,
      validation_errors: null,
      error_message: null,
      created_at,
      updated_at: created_at,
      published_at: null,
      published_product_id: null,
      rejected_at: null,
      rejected_reason: null,
    };

    drafts.set(id, draft);

    return HttpResponse.json({ ok: true, event_id: id });
  }),

  http.get("*/admin/ai/product-drafts/:draftId", ({ params }) => {
    const draftId = String((params as Record<string, string>).draftId);
    const stored = drafts.get(draftId);
    if (!stored) {
      return HttpResponse.json({ message: "Not found" }, { status: 404 });
    }

    const nextStatus = computeStatus(stored);
    let nextDraft: StoredDraft = stored;

    if (nextStatus !== stored.status) {
      nextDraft = { ...stored, status: nextStatus, updated_at: nowIso() };
    }

    if (nextStatus === "FAILED") {
      nextDraft = {
        ...nextDraft,
        error_message:
          nextDraft.error_message ??
          "Mock failure: crawler could not fetch or parse the page.",
      };
    }

    if (nextStatus === "READY_FOR_REVIEW") {
      nextDraft = ensurePayload(nextDraft);
    }

    drafts.set(draftId, nextDraft);
    return HttpResponse.json(toApiShape(nextDraft));
  }),

  http.get("*/admin/ai/product-drafts", ({ request }) => {
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");
    const items = Array.from(drafts.values())
      .map((draft) => {
        const nextStatus = computeStatus(draft);
        if (nextStatus !== draft.status) {
          const nextDraft = { ...draft, status: nextStatus, updated_at: nowIso() };
          drafts.set(draft.id, nextDraft);
          return nextDraft;
        }
        return draft;
      })
      .filter((draft) => (statusFilter ? draft.status === statusFilter : true))
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .slice(0, 50)
      .map((draft) => ({
        draft_id: draft.id,
        status: draft.status,
        source_url: draft.source_url,
        updated_at: draft.updated_at,
      }));

    return HttpResponse.json({ items, next_cursor: null });
  }),

  http.post("*/admin/ai/product-drafts/:draftId/publish", ({ params }) => {
    const draftId = String((params as Record<string, string>).draftId);
    const stored = drafts.get(draftId);
    if (!stored) {
      return HttpResponse.json({ message: "Not found" }, { status: 404 });
    }

    const computed = computeStatus(stored);
    if (computed !== "READY_FOR_REVIEW") {
      return HttpResponse.json(
        { message: "Draft is not ready for review" },
        { status: 409 }
      );
    }

    const published_at = nowIso();
    const published_product_id = newId();
    const next: StoredDraft = {
      ...ensurePayload(stored),
      status: "PUBLISHED",
      updated_at: published_at,
      published_at,
      published_product_id,
    };

    drafts.set(draftId, next);

    return HttpResponse.json({
      draft_id: draftId,
      status: "PUBLISHED",
      product_id: published_product_id,
    });
  }),

  http.post("*/admin/ai/product-drafts/:draftId/reject", async ({ params, request }) => {
    const draftId = String((params as Record<string, string>).draftId);
    const stored = drafts.get(draftId);
    if (!stored) {
      return HttpResponse.json({ message: "Not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | { reason?: string }
      | null;

    const rejected_at = nowIso();
    const next: StoredDraft = {
      ...stored,
      status: "REJECTED",
      updated_at: rejected_at,
      rejected_at,
      rejected_reason: body?.reason?.trim() || null,
    };

    drafts.set(draftId, next);

    return HttpResponse.json({
      draft_id: draftId,
      status: "REJECTED",
    });
  }),
];
