import { withApiBaseUrl } from "@/lib/api-base-url";
import { apiFetch } from "@/lib/api-client";

export type ProductDraftStatus =
  | "FOUND"
  | "QUEUED_FOR_DRAFT"
  | "CRAWLING"
  | "DRAFTING"
  | "READY_FOR_REVIEW"
  | "PUBLISHED"
  | "FAILED"
  | "REJECTED";

export type ProductDraftPayload = {
  captured_at?: string | null;
  currency?: string | null;
  description?: string | null;
  images?: string[] | null;
  variations?: {
    image?: string | null;
    position?: number | string | null;
    title?: string | null;
  }[] | null;
  price?: string | number | null;
  source?: string | null;
  status?: string | null;
  title?: string | null;
  url?: string | null;
  [key: string]: unknown;
};

export type ProductDraft = {
  id: string;
  status: ProductDraftStatus;
  draft: ProductDraftPayload | null;
  error: string | null;
  created_by: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  published_at_ms: number | null;
  published_product_id: string | null;
};

export type CreateDraftRequest = {
  url: string;
};

export async function enqueueCrawlJob(
  body: CreateDraftRequest
): Promise<{ ok?: boolean; id: string }> {
  const response = await apiFetch(withApiBaseUrl("/v1/admin/crawl/enqueue"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const message =
      typeof err?.message === "string"
        ? err.message
        : "Failed to enqueue crawl job";
    throw new Error(message);
  }

  return response.json();
}

export async function getProductDraft(draftId: string): Promise<ProductDraft> {
  const response = await apiFetch(
    withApiBaseUrl(`/v1/admin/product-drafts/${draftId}`),
    {
      method: "GET",
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const message =
      typeof err?.message === "string" ? err.message : "Failed to load draft";
    throw new Error(message);
  }

  return response.json();
}

export async function updateProductDraft(
  draftId: string,
  payload: ProductDraftPayload
): Promise<ProductDraft> {
  const response = await apiFetch(
    withApiBaseUrl(`/v1/product-drafts/${draftId}`),
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const message =
      typeof err?.message === "string" ? err.message : "Failed to update draft";
    throw new Error(message);
  }

  return response.json();
}

export async function publishProductDraft(
  draftId: string
): Promise<{ draft_id: string; status: ProductDraftStatus; product_id: string }> {
  const response = await apiFetch(
    withApiBaseUrl(`/v1/product-drafts/${draftId}/publish`),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const message =
      typeof err?.message === "string" ? err.message : "Failed to publish";
    throw new Error(message);
  }

  return response.json();
}

export async function rejectProductDraft(
  draftId: string,
  reason?: string
): Promise<{ draft_id: string; status: ProductDraftStatus }> {
  const response = await apiFetch(
    withApiBaseUrl(`/v1/product-drafts/${draftId}/reject`),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason }),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const message =
      typeof err?.message === "string" ? err.message : "Failed to reject";
    throw new Error(message);
  }

  return response.json();
}

export function isTerminalStatus(status: ProductDraftStatus): boolean {
  return (
    status === "READY_FOR_REVIEW" ||
    status === "PUBLISHED" ||
    status === "FAILED" ||
    status === "REJECTED"
  );
}
