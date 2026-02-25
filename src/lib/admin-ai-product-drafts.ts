import { withApiBaseUrl } from "@/lib/api-base-url";
import { apiFetch } from "@/lib/api-client";

function getErrorMessageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.error === "string" && record.error.trim()) {
    return record.error;
  }

  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }

  return null;
}

async function parseApiErrorMessage(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  const payload = await response.json().catch(() => null);
  return getErrorMessageFromPayload(payload) ?? fallbackMessage;
}

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
  category_ids?: number[] | null;
  category_branch?:
    | {
        id: number;
        tier?: number | null;
        is_leaf?: boolean;
      }[]
    | null;
  captured_at?: string | null;
  currency?: string | null;
  description?: string | null;
  images?: string[] | null;
  main_image_ref?: {
    container?: "main" | "variation" | null;
    variation_position?: number | null;
    url?: string | null;
  } | null;
  variations?: {
    images?: string[] | null;
    position?: number | string | null;
    price?: string | number | null;
    title?: string | null;
  }[] | null;
  price?: string | number | null;
  shipping_fee?: number | null;
  source?: string | null;
  status?: string | null;
  tax_rate?: string | number | null;
  title?: string | null;
  url?: string | null;
  visibility?: boolean | null;
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

export type CategoryBranchNode = {
  id: number;
  name: string;
  label: string;
  tier: number;
};

export type CategoryTaxonomyCandidate = {
  leaf_id: number;
  leaf_name: string;
  leaf_label: string;
  leaf_tier: number;
  matched_tiers: number[];
  matched_path: string[];
  branch: CategoryBranchNode[];
};

export type CategoryTaxonomySearchResponse = {
  query: string;
  count: number;
  candidates: CategoryTaxonomyCandidate[];
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
    throw new Error(await parseApiErrorMessage(response, "Failed to enqueue crawl job"));
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
    throw new Error(await parseApiErrorMessage(response, "Failed to load draft"));
  }

  return response.json();
}

export async function searchCategoryTaxonomy(
  query: string,
  options?: {
    limit?: number;
    includeParents?: boolean;
  }
): Promise<CategoryTaxonomySearchResponse> {
  const trimmed = query.trim();
  if (!trimmed.length) {
    return { query: "", count: 0, candidates: [] };
  }

  const params = new URLSearchParams({
    q: trimmed,
    limit: String(options?.limit ?? 20),
    include_parents: options?.includeParents === false ? "false" : "true",
  });

  const response = await apiFetch(
    withApiBaseUrl(`/v1/admin/categories/taxonomy/search?${params.toString()}`),
    {
      method: "GET",
    }
  );

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, "Failed to search categories"));
  }

  return response.json();
}

export async function updateProductDraft(
  draftId: string,
  payload: ProductDraftPayload
): Promise<ProductDraft> {
  const response = await apiFetch(
    withApiBaseUrl(`/v1/admin/product-drafts/${draftId}`),
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, "Failed to update draft"));
  }

  return response.json();
}

export type PublishProductDraftRequest = {
  draft_id: string;
} & ProductDraftPayload;

export type PublishProductDraftResponse = {
  draft_id: string;
  status: ProductDraftStatus;
  product_id: string;
  visibility?: boolean;
};

export async function publishProductDraft(
  draftId: string,
  payload: PublishProductDraftRequest
): Promise<PublishProductDraftResponse> {
  const response = await apiFetch(
    withApiBaseUrl(`/v1/admin/product-drafts/${draftId}/publish`),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, "Failed to publish"));
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
    throw new Error(await parseApiErrorMessage(response, "Failed to reject"));
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
