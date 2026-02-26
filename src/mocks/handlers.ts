import { http, HttpResponse } from "msw";

import type { ProductDraft, ProductDraftPayload, ProductDraftStatus } from "./types";

type StoredDraft = ProductDraft;

const drafts = new Map<string, StoredDraft>();

function nowMs(): number {
  return Date.now();
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

  const elapsedMs = Date.now() - draft.created_at_ms;
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));

  if (draft.draft?.url?.includes("fail") && elapsedSeconds >= 4) {
    return "FAILED";
  }

  if (elapsedSeconds < 2) return "QUEUED_FOR_DRAFT";
  if (elapsedSeconds < 5) return "CRAWLING";
  if (elapsedSeconds < 8) return "DRAFTING";
  return "READY_FOR_REVIEW";
}

function isProductDraftStatusValue(value: string): value is ProductDraftStatus {
  return (
    value === "FOUND" ||
    value === "QUEUED_FOR_DRAFT" ||
    value === "CRAWLING" ||
    value === "DRAFTING" ||
    value === "READY_FOR_REVIEW" ||
    value === "PUBLISHED" ||
    value === "FAILED" ||
    value === "REJECTED"
  );
}

function ensurePayload(draft: StoredDraft): StoredDraft {
  if (draft.draft) return draft;

  const url = null;
  const payload: ProductDraftPayload = {
    captured_at: new Date().toISOString(),
    currency: "TWD",
    description: "Mock description generated from the supplier page.",
    images: ["https://picsum.photos/seed/peasydeal/640/640"],
    price: "499",
    source: "shopee",
    status: "ok",
    title: "Mock Product Title",
    url,
  };

  return {
    ...draft,
    draft: payload,
  };
}

type DraftListCursor = {
  updated_at_ms: number;
  id: string;
};

function encodeCursor(cursor: DraftListCursor): string {
  return encodeURIComponent(JSON.stringify(cursor));
}

function decodeCursor(rawCursor: string): DraftListCursor | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(rawCursor)) as Partial<DraftListCursor>;
    if (
      typeof parsed.updated_at_ms !== "number" ||
      !Number.isFinite(parsed.updated_at_ms) ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) {
      return null;
    }
    return {
      updated_at_ms: parsed.updated_at_ms,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}

function compareDraftByUpdatedDesc(a: StoredDraft, b: StoredDraft): number {
  if (a.updated_at_ms !== b.updated_at_ms) {
    return a.updated_at_ms < b.updated_at_ms ? 1 : -1;
  }
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

function isAfterCursor(item: StoredDraft, cursor: DraftListCursor): boolean {
  if (item.updated_at_ms < cursor.updated_at_ms) return true;
  if (item.updated_at_ms > cursor.updated_at_ms) return false;
  return item.id < cursor.id;
}

function resolveThumbnailUrl(draft: StoredDraft): string | null {
  const payload = draft.draft;
  if (!payload || typeof payload !== "object") return null;

  const mainRef = payload.main_image_ref;
  if (mainRef && typeof mainRef === "object" && typeof mainRef.url === "string") {
    const url = mainRef.url.trim();
    if (url.length > 0) return url;
  }

  if (Array.isArray(payload.images)) {
    for (const image of payload.images) {
      if (typeof image !== "string") continue;
      const trimmed = image.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }

  return null;
}

export const handlers = [
  http.post("*/v1/admin/crawl/enqueue", async ({ request }) => {
    const body = (await request.json().catch(() => null)) as
      | { url?: string }
      | null;

    const url = body?.url?.trim();
    if (!url) {
      return HttpResponse.json({ message: "url is required" }, { status: 400 });
    }

    const id = newId();
    const created_at_ms = nowMs();

    const draft: StoredDraft = {
      id,
      status: "QUEUED_FOR_DRAFT",
      draft: { url },
      error: null,
      created_by: "enqueue",
      created_at_ms,
      updated_at_ms: created_at_ms,
      published_at_ms: null,
      published_product_id: null,
    };

    drafts.set(id, draft);

    return HttpResponse.json({ ok: true, id });
  }),

  http.get("*/v1/admin/product-drafts/:draftId", ({ params }) => {
    const draftId = String((params as Record<string, string>).draftId);
    const stored = drafts.get(draftId);
    if (!stored) {
      return HttpResponse.json({ message: "Not found" }, { status: 404 });
    }

    const nextStatus = computeStatus(stored);
    let nextDraft: StoredDraft = stored;

    if (nextStatus !== stored.status) {
      nextDraft = { ...stored, status: nextStatus, updated_at_ms: nowMs() };
    }

    if (nextStatus === "FAILED") {
      nextDraft = {
        ...nextDraft,
        error:
          nextDraft.error ??
          "Mock failure: crawler could not fetch or parse the page.",
      };
    }

    if (nextStatus === "READY_FOR_REVIEW") {
      nextDraft = ensurePayload(nextDraft);
    }

    drafts.set(draftId, nextDraft);
    return HttpResponse.json(nextDraft);
  }),

  http.get("*/v1/admin/product-drafts", ({ request }) => {
    const url = new URL(request.url);
    const statusFilterRaw = url.searchParams.get("status");
    if (statusFilterRaw && !isProductDraftStatusValue(statusFilterRaw)) {
      return HttpResponse.json(
        { error: `invalid status: "${statusFilterRaw}"` },
        { status: 400 }
      );
    }

    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit == null ? 50 : Number(rawLimit);
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      return HttpResponse.json(
        { error: `invalid limit: "${rawLimit}"` },
        { status: 400 }
      );
    }

    const rawCursor = url.searchParams.get("cursor");
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) {
      return HttpResponse.json({ error: "invalid cursor" }, { status: 400 });
    }

    const items = Array.from(drafts.values())
      .map((draft) => {
        const nextStatus = computeStatus(draft);
        if (nextStatus !== draft.status) {
          const nextDraft = { ...draft, status: nextStatus, updated_at_ms: nowMs() };
          drafts.set(draft.id, nextDraft);
          return nextDraft;
        }
        return draft;
      })
      .filter((draft) => (statusFilterRaw ? draft.status === statusFilterRaw : true))
      .filter((draft) => {
        if (!q.length) return true;
        const idHit = draft.id.toLowerCase().includes(q);
        const urlHit = (draft.draft?.url ?? "").toLowerCase().includes(q);
        return idHit || urlHit;
      })
      .sort(compareDraftByUpdatedDesc)
      .filter((draft) => (cursor ? isAfterCursor(draft, cursor) : true));

    const paged = items.slice(0, limit);
    const nextCursor =
      items.length > paged.length && paged.length > 0
        ? encodeCursor({
            updated_at_ms: paged[paged.length - 1].updated_at_ms,
            id: paged[paged.length - 1].id,
          })
        : null;

    return HttpResponse.json({
      items: paged
      .map((draft) => ({
        id: draft.id,
        status: draft.status,
        url: draft.draft?.url ?? null,
        thumbnail_url: resolveThumbnailUrl(draft),
        updated_at_ms: draft.updated_at_ms,
      })),
      next_cursor: nextCursor,
    });
  }),

  http.post("*/v1/admin/product-drafts/:draftId/publish", async ({ params, request }) => {
    const draftId = String((params as Record<string, string>).draftId);
    const stored = drafts.get(draftId);
    if (!stored) {
      return HttpResponse.json({ message: "Not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | ({ draft_id?: string } & ProductDraftPayload)
      | null;
    if (!body || body.draft_id !== draftId) {
      return HttpResponse.json({ message: "draft_id mismatch" }, { status: 400 });
    }

    const finalPayload: ProductDraftPayload = { ...body };
    delete (finalPayload as { draft_id?: string }).draft_id;
    const visibility =
      typeof finalPayload.visibility === "boolean" ? finalPayload.visibility : true;

    const computed = computeStatus(stored);
    if (computed !== "READY_FOR_REVIEW") {
      return HttpResponse.json(
        { message: "Draft is not ready for review" },
        { status: 409 }
      );
    }

    const published_at_ms = nowMs();
    const published_product_id = newId();
    const ensured = ensurePayload(stored);
    const next: StoredDraft = {
      ...ensured,
      draft: {
        ...ensured.draft,
        ...finalPayload,
        visibility: typeof finalPayload.visibility === "boolean" ? finalPayload.visibility : visibility,
      },
      status: "PUBLISHED",
      updated_at_ms: published_at_ms,
      published_at_ms,
      published_product_id,
    };

    drafts.set(draftId, next);

    return HttpResponse.json({
      draft_id: draftId,
      status: "PUBLISHED",
      product_id: published_product_id,
      visibility,
    });
  }),

  http.post("*/v1/product-drafts/:draftId/reject", ({ params }) => {
    const draftId = String((params as Record<string, string>).draftId);
    const stored = drafts.get(draftId);
    if (!stored) {
      return HttpResponse.json({ message: "Not found" }, { status: 404 });
    }

    const rejected_at_ms = nowMs();
    const next: StoredDraft = {
      ...stored,
      status: "REJECTED",
      updated_at_ms: rejected_at_ms,
    };

    drafts.set(draftId, next);

    return HttpResponse.json({
      draft_id: draftId,
      status: "REJECTED",
    });
  }),

  http.put("*/v1/admin/product-drafts/:draftId", async ({ params, request }) => {
    const draftId = String((params as Record<string, string>).draftId);
    const stored = drafts.get(draftId);
    if (!stored) {
      return HttpResponse.json({ message: "Not found" }, { status: 404 });
    }

    const updates = (await request.json().catch(() => null)) as
      | ProductDraftPayload
      | null;

    if (!updates) {
      return HttpResponse.json({ message: "Invalid payload" }, { status: 400 });
    }

    const next: StoredDraft = {
      ...ensurePayload(stored),
      draft: {
        ...ensurePayload(stored).draft,
        ...updates,
      },
      updated_at_ms: nowMs(),
    };

    drafts.set(draftId, next);

    return HttpResponse.json(next);
  }),
];
