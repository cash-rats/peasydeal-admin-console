import { withApiBaseUrl, withPublishApiBaseUrl } from "@/lib/api-base-url";
import { apiFetch } from "@/lib/api-client";

function getErrorMessageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const code = typeof record.code === "string" && record.code.trim() ? record.code : null;

  if (typeof record.error === "string" && record.error.trim()) {
    return code ? `${record.error} (${code})` : record.error;
  }

  if (typeof record.message === "string" && record.message.trim()) {
    return code ? `${record.message} (${code})` : record.message;
  }

  if (code) return code;
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

export type PublishTarget = "staging" | "production";

export type PublishStateStatus =
  | "NOT_PUBLISHED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED";

export type PublishState = {
  status: PublishStateStatus;
  product_id: string | null;
  product_uuid: string | null;
  published_at_ms: number | null;
  error: string | null;
};

export type PublishStateCollection = {
  staging: PublishState;
  production: PublishState;
};

export type PublishStateSummary = {
  staging: { status: PublishStateStatus };
  production: { status: PublishStateStatus };
};

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
  publish_state: PublishStateCollection;
};

export type ProductDraftListItem = {
  id: string;
  status: ProductDraftStatus;
  url: string | null;
  thumbnail_url: string | null;
  updated_at_ms: number;
  publish_state_summary: PublishStateSummary;
};

export type ListProductDraftsQuery = {
  status?: ProductDraftStatus;
  q?: string;
  limit?: number;
  cursor?: string;
};

export type ListProductDraftsResponse = {
  items: ProductDraftListItem[];
  next_cursor: string | null;
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

  return normalizeProductDraft(await response.json().catch(() => null));
}

function isProductDraftStatus(value: unknown): value is ProductDraftStatus {
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

function toEpochMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const asDateMs = Date.parse(value);
    if (Number.isFinite(asDateMs)) return asDateMs;
  }
  return 0;
}

function isPublishStateStatus(value: unknown): value is PublishStateStatus {
  return (
    value === "NOT_PUBLISHED" ||
    value === "PUBLISHING" ||
    value === "PUBLISHED" ||
    value === "FAILED"
  );
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizePublishState(value: unknown): PublishState {
  if (!value || typeof value !== "object") {
    return {
      status: "NOT_PUBLISHED",
      product_id: null,
      product_uuid: null,
      published_at_ms: null,
      error: null,
    };
  }

  const record = value as Record<string, unknown>;
  return {
    status: isPublishStateStatus(record.status) ? record.status : "NOT_PUBLISHED",
    product_id: toNullableString(record.product_id),
    product_uuid: toNullableString(record.product_uuid),
    published_at_ms: (() => {
      const ms = toEpochMs(record.published_at_ms);
      return ms > 0 ? ms : null;
    })(),
    error: toNullableString(record.error),
  };
}

export function createEmptyPublishStateCollection(): PublishStateCollection {
  return {
    staging: normalizePublishState(null),
    production: normalizePublishState(null),
  };
}

export function normalizePublishStateCollection(value: unknown): PublishStateCollection {
  if (!value || typeof value !== "object") {
    return createEmptyPublishStateCollection();
  }

  const record = value as Record<string, unknown>;
  return {
    staging: normalizePublishState(record.staging),
    production: normalizePublishState(record.production),
  };
}

function normalizePublishStateSummary(value: unknown): PublishStateSummary {
  const states = normalizePublishStateCollection(value);
  return {
    staging: { status: states.staging.status },
    production: { status: states.production.status },
  };
}

function normalizeProductDraft(payload: unknown): ProductDraft {
  const record = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};

  return {
    id: typeof record.id === "string" ? record.id : "",
    status: isProductDraftStatus(record.status) ? record.status : "QUEUED_FOR_DRAFT",
    draft:
      record.draft && typeof record.draft === "object"
        ? (record.draft as ProductDraftPayload)
        : null,
    error: toNullableString(record.error),
    created_by: toNullableString(record.created_by),
    created_at_ms: toEpochMs(record.created_at_ms ?? record.created_at),
    updated_at_ms: toEpochMs(record.updated_at_ms ?? record.updated_at),
    published_at_ms: (() => {
      const ms = toEpochMs(record.published_at_ms ?? record.published_at);
      return ms > 0 ? ms : null;
    })(),
    published_product_id: toNullableString(record.published_product_id),
    publish_state: normalizePublishStateCollection(record.publish_state),
  };
}

function stripReadonlyDraftFields(payload: ProductDraftPayload): ProductDraftPayload {
  const nextPayload: ProductDraftPayload = { ...payload };
  delete nextPayload.publish_state;
  delete nextPayload.published_at_ms;
  delete nextPayload.published_product_id;

  for (const key of Object.keys(nextPayload)) {
    if (key.startsWith("staging_") || key.startsWith("production_")) {
      delete nextPayload[key];
    }
  }

  return nextPayload;
}

export async function listProductDrafts(
  query: ListProductDraftsQuery = {}
): Promise<ListProductDraftsResponse> {
  const params = new URLSearchParams();

  if (query.status) params.set("status", query.status);
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (typeof query.limit === "number" && Number.isFinite(query.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(query.limit))));
  }
  if (query.cursor?.trim()) params.set("cursor", query.cursor.trim());

  const search = params.toString();
  const response = await apiFetch(
    withApiBaseUrl(`/v1/admin/product-drafts${search ? `?${search}` : ""}`),
    { method: "GET" }
  );

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, "Failed to load draft list"));
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        items?: unknown[];
        next_cursor?: unknown;
      }
    | null;

  const items = Array.isArray(payload?.items)
    ? payload.items
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          const id = typeof record.id === "string" ? record.id : "";
          const status = isProductDraftStatus(record.status)
            ? record.status
            : "QUEUED_FOR_DRAFT";
          const updated_at_ms = toEpochMs(record.updated_at_ms ?? record.updated_at);

          if (!id) return null;
          return {
            id,
            status,
            url: typeof record.url === "string" ? record.url : null,
            thumbnail_url:
              typeof record.thumbnail_url === "string"
                ? record.thumbnail_url
                : null,
            updated_at_ms,
            publish_state_summary: normalizePublishStateSummary(
              record.publish_state_summary
            ),
          } satisfies ProductDraftListItem;
        })
        .filter((item): item is ProductDraftListItem => item !== null)
    : [];

  return {
    items,
    next_cursor: typeof payload?.next_cursor === "string" ? payload.next_cursor : null,
  };
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
      body: JSON.stringify(stripReadonlyDraftFields(payload)),
    }
  );

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, "Failed to update draft"));
  }

  return normalizeProductDraft(await response.json().catch(() => null));
}

export type UploadProductDraftImageRequest = {
  file: File;
  clientImageId?: string;
  container?: "main" | "variation";
  variationId?: string;
};

export type UploadProductDraftImageResponse = {
  url: string;
  content_type?: string;
  size_bytes?: number;
  client_image_id?: string;
};

export async function uploadProductDraftImage(
  draftId: string,
  payload: UploadProductDraftImageRequest
): Promise<UploadProductDraftImageResponse> {
  const formData = new FormData();
  formData.set("file", payload.file);
  if (payload.clientImageId?.trim()) {
    formData.set("client_image_id", payload.clientImageId.trim());
  }
  if (payload.container) {
    formData.set("container", payload.container);
  }
  if (payload.variationId?.trim()) {
    formData.set("variation_id", payload.variationId.trim());
  }

  const response = await apiFetch(
    withApiBaseUrl(`/v1/admin/product-drafts/${draftId}/images/upload`),
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, "Failed to upload draft image"));
  }

  return response.json();
}

export async function deleteProductDraft(
  draftId: string
): Promise<{ draft_id?: string; deleted?: boolean } | null> {
  const response = await apiFetch(
    withApiBaseUrl(`/v1/admin/product-drafts/${draftId}`),
    {
      method: "DELETE",
    }
  );

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, "Failed to delete draft"));
  }

  if (response.status === 204) {
    return null;
  }

  return response.json().catch(() => null);
}

export type PublishProductDraftRequest = {
  draft_id: string;
  target: PublishTarget;
} & ProductDraftPayload;

export type PublishProductDraftResponse = {
  ok: true;
  draft_id: string;
  target: PublishTarget;
  product_id: number | string;
  product_uuid: string | null;
  published_at_ms: number | null;
  idempotent_reused: boolean;
  publish_state: PublishStateCollection;
};

export async function publishProductDraft(
  draftId: string,
  payload: PublishProductDraftRequest
): Promise<PublishProductDraftResponse> {
  const publishUrl = withPublishApiBaseUrl(
    `/v1/admin/product-drafts/${draftId}/publish?target=${encodeURIComponent(
      payload.target
    )}`,
    payload.target
  );
  const { target, ...publishBody } = payload;
  const response = await apiFetch(
    publishUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(publishBody),
    }
  );

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, "Failed to publish"));
  }

  const responsePayload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  return {
    ok: true,
    draft_id:
      typeof responsePayload?.draft_id === "string" ? responsePayload.draft_id : draftId,
    target: responsePayload?.target === "staging" ? "staging" : "production",
    product_id:
      typeof responsePayload?.product_id === "number" ||
      typeof responsePayload?.product_id === "string"
        ? responsePayload.product_id
        : "",
    product_uuid: toNullableString(responsePayload?.product_uuid),
    published_at_ms: (() => {
      const ms = toEpochMs(responsePayload?.published_at_ms);
      return ms > 0 ? ms : null;
    })(),
    idempotent_reused: responsePayload?.idempotent_reused === true,
    publish_state: normalizePublishStateCollection(responsePayload?.publish_state),
  };
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
