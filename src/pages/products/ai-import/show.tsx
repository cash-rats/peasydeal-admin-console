import { useNotification } from "@refinedev/core";
import React from "react";
import { useNavigate, useParams } from "react-router";

import {
  getProductDraft,
  isTerminalStatus,
  publishProductDraft,
  rejectProductDraft,
  type ProductDraft,
  type ProductDraftStatus,
} from "@/lib/admin-ai-product-drafts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";

function statusLabel(status: ProductDraftStatus): string {
  switch (status) {
    case "QUEUED_FOR_DRAFT":
      return "Queued";
    case "CRAWLING":
      return "Crawling";
    case "DRAFTING":
      return "Drafting";
    case "READY_FOR_REVIEW":
      return "Ready for review";
    case "PUBLISHED":
      return "Published";
    case "FAILED":
      return "Failed";
    case "REJECTED":
      return "Rejected";
    case "FOUND":
      return "Found";
    default:
      return status;
  }
}

function statusBadgeVariant(
  status: ProductDraftStatus
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "READY_FOR_REVIEW":
      return "default";
    case "PUBLISHED":
      return "default";
    case "FAILED":
      return "destructive";
    case "REJECTED":
      return "secondary";
    default:
      return "outline";
  }
}

function progressPercent(status: ProductDraftStatus): number {
  switch (status) {
    case "QUEUED_FOR_DRAFT":
      return 15;
    case "CRAWLING":
      return 40;
    case "DRAFTING":
      return 70;
    case "READY_FOR_REVIEW":
      return 90;
    case "PUBLISHED":
      return 100;
    case "FAILED":
    case "REJECTED":
      return 100;
    case "FOUND":
      return 30;
    default:
      return 0;
  }
}

export function AiProductDraftShow() {
  const params = useParams();
  const navigate = useNavigate();
  const { open } = useNotification();

  const draftId = params.id;

  const [draft, setDraft] = React.useState<ProductDraft | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [isPublishing, setIsPublishing] = React.useState(false);
  const [isRejecting, setIsRejecting] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");

  const refresh = React.useCallback(async () => {
    if (!draftId) return;
    setError(null);
    try {
      const next = await getProductDraft(draftId);
      setDraft(next);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [draftId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!draftId) return;
    if (!draft) return;
    if (isTerminalStatus(draft.status)) return;

    const timer = window.setInterval(() => {
      void refresh();
    }, 2500);

    return () => window.clearInterval(timer);
  }, [draft, draftId, refresh]);

  const onPublish = async () => {
    if (!draftId) return;
    setIsPublishing(true);
    try {
      const result = await publishProductDraft(draftId);
      open?.({
        type: "success",
        message: "Published",
        description: `Product ID: ${result.product_id}`,
      });
      await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      open?.({ type: "error", message: "Publish failed", description: message });
    } finally {
      setIsPublishing(false);
    }
  };

  const onReject = async () => {
    if (!draftId) return;
    setIsRejecting(true);
    try {
      await rejectProductDraft(draftId, rejectReason);
      open?.({ type: "success", message: "Rejected" });
      await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      open?.({ type: "error", message: "Reject failed", description: message });
    } finally {
      setIsRejecting(false);
    }
  };

  if (!draftId) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Missing draft id</AlertTitle>
        <AlertDescription>Open this page with a draft id.</AlertDescription>
      </Alert>
    );
  }

  return (
    <ListView>
      <ListViewHeader title="AI Import" canCreate={false} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>Draft</CardTitle>
            <div className="text-sm text-muted-foreground">{draftId}</div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate("/products/ai-import")}
            >
              New draft
            </Button>
            <Button variant="outline" onClick={() => void refresh()}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Failed to load draft</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {isLoading && !draft ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : draft ? (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusBadgeVariant(draft.status)}>
                    {statusLabel(draft.status)}
                  </Badge>
                  <Badge variant="outline">{progressPercent(draft.status)}%</Badge>
                </div>

                <div className="text-sm">
                  <div className="text-muted-foreground">Source URL</div>
                  <a
                    className="break-all underline underline-offset-4"
                    href={draft.source_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {draft.source_url}
                  </a>
                </div>

                <div className="text-xs text-muted-foreground">
                  Updated: {new Date(draft.updated_at).toLocaleString()}
                </div>
              </div>

              <Separator />

              {draft.status === "FAILED" && (
                <Alert variant="destructive">
                  <AlertTitle>Draft failed</AlertTitle>
                  <AlertDescription>
                    {draft.error_message ?? "No error message provided."}
                  </AlertDescription>
                </Alert>
              )}

              {draft.status === "REJECTED" && (
                <Alert>
                  <AlertTitle>Draft rejected</AlertTitle>
                  <AlertDescription>
                    {draft.rejected_reason
                      ? `Reason: ${draft.rejected_reason}`
                      : "No reason provided."}
                  </AlertDescription>
                </Alert>
              )}

              {draft.status === "PUBLISHED" && (
                <Alert>
                  <AlertTitle>Draft published</AlertTitle>
                  <AlertDescription>
                    {draft.published_product_id
                      ? `Product ID: ${draft.published_product_id}`
                      : "Published successfully."}
                  </AlertDescription>
                </Alert>
              )}

              {draft.status === "READY_FOR_REVIEW" && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">Review</div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => void onPublish()}
                        disabled={isPublishing || isRejecting}
                      >
                        {isPublishing ? "Publishing..." : "Publish"}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void onReject()}
                        disabled={isPublishing || isRejecting}
                      >
                        {isRejecting ? "Rejecting..." : "Reject"}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Draft Payload</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <pre className="max-h-[420px] overflow-auto rounded-md bg-muted p-3 text-xs">
                          {JSON.stringify(draft.draft_payload, null, 2)}
                        </pre>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Reject Reason</CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-2">
                        <Textarea
                          rows={6}
                          placeholder="Optional: why this draft should be rejected"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <div className="text-xs text-muted-foreground">
                          Backend will validate required fields on publish; frontend
                          does not block publish based on payload content.
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </ListView>
  );
}
