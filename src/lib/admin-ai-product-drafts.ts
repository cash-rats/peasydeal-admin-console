import { withApiBaseUrl } from "@/lib/api-base-url";

export type ProductDraftStatus =
  | "FOUND"
  | "QUEUED_FOR_DRAFT"
  | "CRAWLING"
  | "DRAFTING"
  | "READY_FOR_REVIEW"
  | "PUBLISHED"
  | "FAILED"
  | "REJECTED";

export type ProductDraft = {
  draft_id: string;
  status: ProductDraftStatus;
  source_url: string;
  input_hints: Record<string, unknown> | null;
  draft_payload: Record<string, unknown> | null;
  validation_errors: unknown[] | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  published_at?: string | null;
  published_product_id?: string | null;
  rejected_at?: string | null;
  rejected_reason?: string | null;
};

export type CreateDraftRequest = {
  url: string;
};

export async function enqueueCrawlJob(
  body: CreateDraftRequest
): Promise<{ ok: boolean; event_id: string }> {
  const response = await fetch(withApiBaseUrl("/v1/crawl/enqueue"), {
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
  const response = await fetch(
    withApiBaseUrl(`/admin/ai/product-drafts/${draftId}`),
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

export async function publishProductDraft(
  draftId: string
): Promise<{ draft_id: string; status: ProductDraftStatus; product_id: string }> {
  const response = await fetch(
    withApiBaseUrl(`/admin/ai/product-drafts/${draftId}/publish`),
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
  const response = await fetch(
    withApiBaseUrl(`/admin/ai/product-drafts/${draftId}/reject`),
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
  return status === "PUBLISHED" || status === "FAILED" || status === "REJECTED";
}
