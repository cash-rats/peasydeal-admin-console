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
