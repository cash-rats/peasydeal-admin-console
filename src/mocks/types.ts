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

