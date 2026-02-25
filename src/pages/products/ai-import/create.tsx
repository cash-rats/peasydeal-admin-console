import { useNotification } from "@refinedev/core";
import React from "react";
import { useNavigate } from "react-router";

import { enqueueCrawlJob } from "@/lib/admin-ai-product-drafts";
import { canonicalizeProductUrl } from "@/lib/canonicalize-product-url";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";

function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function AiProductDraftCreate() {
  const navigate = useNavigate();
  const { open } = useNotification();

  const [sourceUrl, setSourceUrl] = React.useState("");

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmed = sourceUrl.trim();
    if (!trimmed) {
      setError("Please paste a product URL.");
      return;
    }
    if (!looksLikeUrl(trimmed)) {
      setError("Please enter a valid http(s) URL.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await enqueueCrawlJob({ url: canonicalizeProductUrl(trimmed) });

      open?.({
        type: "success",
        message: result.ok === false ? "Enqueue returned not ok" : "Enqueued",
        description: `Draft ID: ${result.id}`,
      });

      navigate(`/products/drafts/${result.id}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
      open?.({
        type: "error",
        message: "Failed to enqueue",
        description: message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ListView>
      <ListViewHeader title="AI Import" canCreate={false} />
      <Card>
        <CardHeader>
          <CardTitle>Import from URL</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-6" onSubmit={onSubmit}>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Cannot create draft</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="sourceUrl">Product URL</Label>
            <Input
              id="sourceUrl"
              placeholder="https://shopee.tw/... or https://item.taobao.com/..."
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                autoComplete="off"
                inputMode="url"
              />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Enqueueing..." : "Enqueue Crawl"}
            </Button>
            <Button
              type="button"
              variant="ghost"
                onClick={() => {
                  setSourceUrl("");
                  setError(null);
                }}
                disabled={isSubmitting}
              >
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </ListView>
  );
}
