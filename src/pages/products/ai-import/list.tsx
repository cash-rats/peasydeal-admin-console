import React from "react";
import { useNavigate } from "react-router";

import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  listProductDrafts,
  type ProductDraftListItem,
  type ProductDraftStatus,
} from "@/lib/admin-ai-product-drafts";
import { cn } from "@/lib/utils";
import { ExternalLink, ImageOff, Loader2, Search, SquarePen } from "lucide-react";

type DraftListTab =
  | "ALL"
  | "READY_FOR_REVIEW"
  | "IN_PROGRESS"
  | "FAILED"
  | "PUBLISHED"
  | "REJECTED";

const PAGE_SIZE = 10;
const IN_PROGRESS_STATUS_SET = new Set<ProductDraftStatus>([
  "FOUND",
  "QUEUED_FOR_DRAFT",
  "CRAWLING",
  "DRAFTING",
]);

const TAB_ITEMS: Array<{ value: DraftListTab; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "READY_FOR_REVIEW", label: "Ready for Review (READY_FOR_REVIEW)" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "FAILED", label: "Failed" },
  { value: "PUBLISHED", label: "Published" },
  { value: "REJECTED", label: "Rejected" },
];

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

function statusBadgeClasses(status: ProductDraftStatus): string {
  switch (status) {
    case "READY_FOR_REVIEW":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "PUBLISHED":
      return "border-teal-200 bg-teal-50 text-teal-900";
    case "FAILED":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "REJECTED":
      return "border-slate-200 bg-slate-50 text-slate-700";
    case "QUEUED_FOR_DRAFT":
      return "border-indigo-200 bg-indigo-50 text-indigo-900";
    case "CRAWLING":
      return "border-sky-200 bg-sky-50 text-sky-900";
    case "DRAFTING":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "FOUND":
      return "border-violet-200 bg-violet-50 text-violet-900";
    default:
      return "border-muted bg-muted/40 text-foreground";
  }
}

function isInProgressStatus(status: ProductDraftStatus): boolean {
  return IN_PROGRESS_STATUS_SET.has(status);
}

function toStatusFilter(tab: DraftListTab): ProductDraftStatus | undefined {
  switch (tab) {
    case "READY_FOR_REVIEW":
    case "FAILED":
    case "PUBLISHED":
    case "REJECTED":
      return tab;
    default:
      return undefined;
  }
}

function filterItemsByTab(items: ProductDraftListItem[], tab: DraftListTab) {
  switch (tab) {
    case "IN_PROGRESS":
      return items.filter((item) => isInProgressStatus(item.status));
    case "READY_FOR_REVIEW":
    case "FAILED":
    case "PUBLISHED":
    case "REJECTED":
      return items.filter((item) => item.status === tab);
    case "ALL":
    default:
      return items;
  }
}

function mergeById(
  previous: ProductDraftListItem[],
  incoming: ProductDraftListItem[]
): ProductDraftListItem[] {
  const next = [...previous];
  for (const item of incoming) {
    const index = next.findIndex((current) => current.id === item.id);
    if (index >= 0) {
      next[index] = item;
      continue;
    }
    next.push(item);
  }
  return next;
}

function getDomain(rawUrl: string | null): string {
  if (!rawUrl) return "—";
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "—";
  }
}

function formatUpdatedAt(updatedAtMs: number): string {
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return "—";
  return new Date(updatedAtMs).toLocaleString();
}

function normalizeSearchTerm(value: string): string {
  return value.trim();
}

export function AiProductDraftList() {
  const navigate = useNavigate();
  const requestIdRef = React.useRef(0);
  const nextCursorRef = React.useRef<string | null>(null);

  const [rows, setRows] = React.useState<ProductDraftListItem[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<DraftListTab>("ALL");
  const [searchInput, setSearchInput] = React.useState("");
  const [searchTerm, setSearchTerm] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastSyncedAtMs, setLastSyncedAtMs] = React.useState<number | null>(null);

  const statusFilter = React.useMemo(
    () => toStatusFilter(activeTab),
    [activeTab]
  );

  React.useEffect(() => {
    nextCursorRef.current = nextCursor;
  }, [nextCursor]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchTerm(normalizeSearchTerm(searchInput));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const fetchPage = React.useCallback(
    async (mode: "initial" | "refresh" | "append") => {
      const cursorToken = mode === "append" ? nextCursorRef.current : undefined;
      if (mode === "append" && !cursorToken) return;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (mode === "initial") setIsLoading(true);
      if (mode === "refresh") setIsRefreshing(true);
      if (mode === "append") setIsLoadingMore(true);

      try {
        const response = await listProductDrafts({
          status: statusFilter,
          q: searchTerm.length > 0 ? searchTerm : undefined,
          limit: PAGE_SIZE,
          cursor: cursorToken ?? undefined,
        });

        if (requestId !== requestIdRef.current) return;

        const filtered = filterItemsByTab(response.items, activeTab);
        setNextCursor(response.next_cursor);
        setError(null);
        setLastSyncedAtMs(Date.now());

        if (mode === "append") {
          setRows((previous) => mergeById(previous, filtered));
          return;
        }

        setRows(filtered);
      } catch (e) {
        if (requestId !== requestIdRef.current) return;
        const message = e instanceof Error ? e.message : "Failed to load draft list";
        setError(message);
      } finally {
        if (requestId !== requestIdRef.current) return;
        if (mode === "initial") setIsLoading(false);
        if (mode === "refresh") setIsRefreshing(false);
        if (mode === "append") setIsLoadingMore(false);
      }
    },
    [activeTab, searchTerm, statusFilter]
  );

  React.useEffect(() => {
    void fetchPage("initial");
  }, [fetchPage]);

  const summary = React.useMemo(
    () => ({
      ready: rows.filter((item) => item.status === "READY_FOR_REVIEW").length,
      inProgress: rows.filter((item) => isInProgressStatus(item.status)).length,
      failed: rows.filter((item) => item.status === "FAILED").length,
      published: rows.filter((item) => item.status === "PUBLISHED").length,
      rejected: rows.filter((item) => item.status === "REJECTED").length,
    }),
    [rows]
  );

  const hasInProgressInCurrentResult = React.useMemo(
    () => rows.some((item) => isInProgressStatus(item.status)),
    [rows]
  );

  React.useEffect(() => {
    if (!hasInProgressInCurrentResult) return;

    const timer = window.setInterval(() => {
      void fetchPage("refresh");
    }, 15000);

    return () => window.clearInterval(timer);
  }, [fetchPage, hasInProgressInCurrentResult]);

  const isInitialLoading = isLoading && rows.length === 0;
  const isEmpty = !isInitialLoading && rows.length === 0;

  return (
    <ListView>
      <ListViewHeader title="Product Drafts" canCreate={false} />

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <CardTitle>Draft Queue</CardTitle>
              <CardDescription>
                Track and review AI-generated product drafts.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  void fetchPage("refresh");
                }}
                disabled={isLoading || isRefreshing || isLoadingMore}
              >
                {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Refresh
              </Button>
              <Button onClick={() => navigate("/products/ai-import")}>
                <SquarePen className="h-4 w-4" />
                New Draft
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <SummaryChip
              label="Ready for Review"
              value={summary.ready}
              isActive={activeTab === "READY_FOR_REVIEW"}
              onClick={() => setActiveTab("READY_FOR_REVIEW")}
            />
            <SummaryChip
              label="In Progress"
              value={summary.inProgress}
              isActive={activeTab === "IN_PROGRESS"}
              onClick={() => setActiveTab("IN_PROGRESS")}
            />
            <SummaryChip
              label="Failed"
              value={summary.failed}
              isActive={activeTab === "FAILED"}
              onClick={() => setActiveTab("FAILED")}
            />
            <SummaryChip
              label="Published"
              value={summary.published}
              isActive={activeTab === "PUBLISHED"}
              onClick={() => setActiveTab("PUBLISHED")}
            />
            <SummaryChip
              label="Rejected"
              value={summary.rejected}
              isActive={activeTab === "REJECTED"}
              onClick={() => setActiveTab("REJECTED")}
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Tabs
              value={activeTab}
              onValueChange={(next) => setActiveTab(next as DraftListTab)}
            >
              <TabsList>
                {TAB_ITEMS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex w-full max-w-sm items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search by draft id or URL"
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Sort: Updated (newest first)
              {hasInProgressInCurrentResult ? " · Auto refresh every 15s" : ""}
            </span>
            <span>
              Last synced: {lastSyncedAtMs ? new Date(lastSyncedAtMs).toLocaleTimeString() : "—"}
            </span>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Failed to load drafts</AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-4">
                <span>{error}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void fetchPage("initial");
                  }}
                >
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[84px]">Preview</TableHead>
                  <TableHead className="w-[180px]">Status</TableHead>
                  <TableHead>Draft ID</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="w-[200px]">Updated</TableHead>
                  <TableHead className="w-[210px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isInitialLoading
                  ? Array.from({ length: 8 }).map((_, index) => (
                      <TableRow key={`loading-${index}`} aria-hidden="true">
                        <TableCell colSpan={6}>
                          <div className="h-10 animate-pulse rounded bg-muted" />
                        </TableCell>
                      </TableRow>
                    ))
                  : rows.map((item) => (
                      <TableRow
                        key={item.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/products/drafts/${item.id}`)}
                      >
                        <TableCell>
                          {item.thumbnail_url ? (
                            <img
                              src={item.thumbnail_url}
                              alt=""
                              loading="lazy"
                              className="h-12 w-12 rounded border object-cover"
                            />
                          ) : (
                            <div
                              className={cn(
                                "flex h-12 w-12 items-center justify-center rounded border bg-muted text-muted-foreground"
                              )}
                            >
                              <ImageOff className="h-4 w-4" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={statusBadgeVariant(item.status)}
                            className={statusBadgeClasses(item.status)}
                          >
                            {statusLabel(item.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{item.id}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-muted-foreground">
                              {getDomain(item.url)}
                            </span>
                            <span className="max-w-[440px] truncate text-sm" title={item.url ?? ""}>
                              {item.url ?? "—"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{formatUpdatedAt(item.updated_at_ms)}</TableCell>
                        <TableCell>
                          <div
                            className="flex items-center gap-2"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Button
                              size="sm"
                              onClick={() => navigate(`/products/drafts/${item.id}`)}
                            >
                              Review
                            </Button>
                            {item.url ? (
                              <Button size="sm" variant="ghost" asChild>
                                <a href={item.url} target="_blank" rel="noreferrer">
                                  <ExternalLink className="h-4 w-4" />
                                  Source
                                </a>
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" disabled>
                                <ExternalLink className="h-4 w-4" />
                                Source
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>

          {rows.length > 0 && nextCursor ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => {
                  void fetchPage("append");
                }}
                disabled={isLoadingMore || isRefreshing || isLoading}
              >
                {isLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Load More
              </Button>
            </div>
          ) : null}

          {isEmpty ? (
            <div className="rounded-md border border-dashed p-10 text-center">
              <div className="text-base font-semibold">No drafts found</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {searchTerm.length
                  ? "Try a different keyword or clear current filters."
                  : "Start by creating a new draft from a product URL."}
              </div>
              <div className="mt-4 flex items-center justify-center gap-2">
                {searchTerm.length || activeTab !== "ALL" ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchInput("");
                      setSearchTerm("");
                      setActiveTab("ALL");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null}
                <Button onClick={() => navigate("/products/ai-import")}>
                  New Draft
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </ListView>
  );
}

type SummaryChipProps = {
  label: string;
  value: number;
  isActive: boolean;
  onClick: () => void;
};

function SummaryChip({ label, value, isActive, onClick }: SummaryChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border p-3 text-left transition-colors",
        "hover:bg-accent",
        isActive ? "border-primary bg-primary/5" : "border-border"
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </button>
  );
}
