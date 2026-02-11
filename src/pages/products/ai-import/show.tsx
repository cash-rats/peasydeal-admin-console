import { useNotification } from "@refinedev/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React from "react";
import { useNavigate, useParams } from "react-router";

import {
  getProductDraft,
  isTerminalStatus,
  publishProductDraft,
  rejectProductDraft,
  updateProductDraft,
  type ProductDraft,
  type ProductDraftPayload,
  type ProductDraftStatus,
} from "@/lib/admin-ai-product-drafts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { cn } from "@/lib/utils";
import { GripVertical, ImagePlus, X } from "lucide-react";

type EditSnapshot = {
  title: string;
  description: string;
  currency: string;
  price: string;
  imageUrls: string[];
  url: string;
  variationSnapshots: VariationSnapshotItem[];
};

type EditImageItem = {
  id: string;
  type: "existing" | "new";
  url?: string;
  file?: File;
  previewUrl: string;
};

type VariationSnapshotItem = {
  imageUrls: string[];
  position: string;
  title: string;
};

type EditVariationItem = {
  id: string;
  title: string;
  position: string;
  images: EditImageItem[];
};

type ImageContainerId = "main" | `variation:${string}`;
type DragKind = "variation_row" | "image_item" | null;

type EditState = EditSnapshot & {
  images: EditImageItem[];
  variations: EditVariationItem[];
  isDirty: boolean;
};

const CURRENCY_OPTIONS = [
  "USD",
  "TWD",
  "JPY",
  "KRW",
  "CNY",
  "HKD",
  "SGD",
  "EUR",
  "GBP",
];

function toEditSnapshot(payload: ProductDraftPayload): EditSnapshot {
  return {
    title: typeof payload.title === "string" ? payload.title : "",
    description: typeof payload.description === "string" ? payload.description : "",
    currency: typeof payload.currency === "string" ? payload.currency : "",
    price:
      typeof payload.price === "number" || typeof payload.price === "string"
        ? String(payload.price)
        : "",
    imageUrls: Array.isArray(payload.images)
      ? payload.images.filter((item): item is string => typeof item === "string")
      : [],
    url: typeof payload.url === "string" ? payload.url : "",
    variationSnapshots: Array.isArray(payload.variations)
      ? payload.variations.map((item) => ({
          imageUrls:
            item && Array.isArray(item.images)
              ? item.images.filter((image): image is string => typeof image === "string")
              : [],
          position:
            item && (typeof item.position === "number" || typeof item.position === "string")
              ? String(item.position)
              : "",
          title: item && typeof item.title === "string" ? item.title : "",
        }))
      : [],
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `img_${Math.random().toString(16).slice(2)}`;
}

function createEditState(snapshot: EditSnapshot): EditState {
  const images = snapshot.imageUrls.map((url) => ({
    id: newId(),
    type: "existing" as const,
    url,
    previewUrl: url,
  }));

  const variations = snapshot.variationSnapshots.map((variation) => ({
    id: newId(),
    title: variation.title,
    position: variation.position,
    images: variation.imageUrls.map((url) => ({
      id: newId(),
      type: "existing" as const,
      url,
      previewUrl: url,
    })),
  }));

  return {
    ...snapshot,
    images,
    variations,
    isDirty: false,
  };
}

function isSameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function normalizeVariationPositions(
  variations: EditVariationItem[]
): EditVariationItem[] {
  return variations.map((variation, index) => ({
    ...variation,
    position: String(index),
  }));
}

function computeIsDirty(state: EditState, snapshot: EditSnapshot): boolean {
  if (state.title !== snapshot.title) return true;
  if (state.description !== snapshot.description) return true;
  if (state.currency !== snapshot.currency) return true;
  if (state.price !== snapshot.price) return true;
  if (state.url !== snapshot.url) return true;
  if (state.images.some((image) => image.type === "new")) return true;
  const existingUrls = state.images
    .filter((image) => image.type === "existing" && image.url)
    .map((image) => image.url as string);
  if (!isSameStringArray(existingUrls, snapshot.imageUrls)) return true;

  if (state.variations.length !== snapshot.variationSnapshots.length) return true;
  for (let i = 0; i < state.variations.length; i += 1) {
    const current = state.variations[i];
    const original = snapshot.variationSnapshots[i];
    if (!original) return true;
    if (current.images.some((image) => image.type === "new")) return true;
    const currentImageUrls = current.images
      .filter((image) => image.type === "existing" && image.url)
      .map((image) => image.url as string);
    if (!isSameStringArray(currentImageUrls, original.imageUrls)) return true;
    if (current.title !== original.title) return true;
    if (current.position !== original.position) return true;
  }

  return false;
}

function revokeNewImagePreviews(state: EditState | null) {
  if (!state) return;
  state.images.forEach((image) => {
    if (image.type === "new") {
      URL.revokeObjectURL(image.previewUrl);
    }
  });
}

function revokeNewVariationPreviews(state: EditState | null) {
  if (!state) return;
  state.variations.forEach((variation) => {
    variation.images.forEach((image) => {
      if (image.type === "new") {
        URL.revokeObjectURL(image.previewUrl);
      }
    });
  });
}

function addImages(state: EditState, files: File[]): EditState {
  const nextImages = files
    .filter((file) => file.type.startsWith("image/"))
    .map((file) => ({
      id: newId(),
      type: "new" as const,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

  return {
    ...state,
    images: [...state.images, ...nextImages],
  };
}

function removeImage(state: EditState, image: EditImageItem): EditState {
  if (image.type === "new") {
    URL.revokeObjectURL(image.previewUrl);
  }

  return {
    ...state,
    images: state.images.filter((item) => item.id !== image.id),
  };
}

function addVariation(state: EditState): EditState {
  const item: EditVariationItem = {
    id: newId(),
    title: "",
    position: "0",
    images: [],
  };

  return {
    ...state,
    variations: normalizeVariationPositions([...state.variations, item]),
  };
}

function removeVariation(state: EditState, variation: EditVariationItem): EditState {
  variation.images.forEach((image) => {
    if (image.type === "new") {
      URL.revokeObjectURL(image.previewUrl);
    }
  });

  return {
    ...state,
    variations: normalizeVariationPositions(
      state.variations.filter((item) => item.id !== variation.id)
    ),
  };
}

function addVariationImagesFromFile(
  state: EditState,
  variationId: string,
  files: File[]
): EditState {
  const nextImages = files
    .filter((file) => file.type.startsWith("image/"))
    .map((file) => ({
      id: newId(),
      type: "new" as const,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
  if (!nextImages.length) return state;

  return {
    ...state,
    variations: state.variations.map((item) => {
      if (item.id !== variationId) return item;
      return {
        ...item,
        images: [...item.images, ...nextImages],
      };
    }),
  };
}

function addVariationImageFromUrl(
  state: EditState,
  variationId: string,
  imageUrl: string
): EditState {
  const trimmed = imageUrl.trim();
  if (!trimmed.length) return state;

  return {
    ...state,
    variations: state.variations.map((item) => {
      if (item.id !== variationId) return item;
      return {
        ...item,
        images: [
          ...item.images,
          {
            id: newId(),
            type: "existing",
            url: trimmed,
            previewUrl: trimmed,
          },
        ],
      };
    }),
  };
}

function removeVariationImage(
  state: EditState,
  variationId: string,
  imageId: string
): EditState {
  return {
    ...state,
    variations: state.variations.map((item) => {
      if (item.id !== variationId) return item;
      const target = item.images.find((image) => image.id === imageId);
      if (target?.type === "new") {
        URL.revokeObjectURL(target.previewUrl);
      }
      return {
        ...item,
        images: item.images.filter((image) => image.id !== imageId),
      };
    }),
  };
}

function updateVariationImageUrl(
  state: EditState,
  variationId: string,
  imageId: string,
  imageUrl: string
): EditState {
  return {
    ...state,
    variations: state.variations.map((item) => {
      if (item.id !== variationId) return item;
      return {
        ...item,
        images: item.images.map((image) => {
          if (image.id !== imageId || image.type !== "existing") return image;
          return {
            ...image,
            url: imageUrl,
            previewUrl: imageUrl,
          };
        }),
      };
    }),
  };
}

function updateVariationField(
  state: EditState,
  variationId: string,
  updater: (item: EditVariationItem) => EditVariationItem
): EditState {
  return {
    ...state,
    variations: state.variations.map((item) =>
      item.id === variationId ? updater(item) : item
    ),
  };
}

function toVariationContainerId(variationId: string): ImageContainerId {
  return `variation:${variationId}`;
}

function getVariationId(containerId: ImageContainerId): string | null {
  if (!containerId.startsWith("variation:")) return null;
  return containerId.slice("variation:".length) || null;
}

function moveImageBetweenContainers(
  state: EditState,
  sourceContainer: ImageContainerId,
  targetContainer: ImageContainerId,
  imageId: string
): EditState {
  if (sourceContainer === targetContainer) return state;

  const sourceVariationId = getVariationId(sourceContainer);
  const targetVariationId = getVariationId(targetContainer);

  const sourceVariation =
    sourceVariationId != null
      ? state.variations.find((variation) => variation.id === sourceVariationId)
      : null;
  const targetVariation =
    targetVariationId != null
      ? state.variations.find((variation) => variation.id === targetVariationId)
      : null;

  const sourceImages =
    sourceContainer === "main" ? state.images : sourceVariation?.images ?? null;
  if (!sourceImages) return state;

  const image = sourceImages.find((item) => item.id === imageId);
  if (!image) return state;

  if (targetContainer !== "main" && !targetVariation) return state;

  if (sourceContainer === "main" && targetVariationId) {
    return {
      ...state,
      images: state.images.filter((item) => item.id !== imageId),
      variations: state.variations.map((variation) => {
        if (variation.id !== targetVariationId) return variation;
        return {
          ...variation,
          images: [...variation.images, image],
        };
      }),
    };
  }

  if (sourceVariationId && targetContainer === "main") {
    return {
      ...state,
      images: [...state.images, image],
      variations: state.variations.map((variation) => {
        if (variation.id !== sourceVariationId) return variation;
        return {
          ...variation,
          images: variation.images.filter((item) => item.id !== imageId),
        };
      }),
    };
  }

  return state;
}

function SortableVariationRow({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, data: { dragType: "variation_row" } });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3",
        isDragging ? "opacity-80 shadow-lg" : ""
      )}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">Variation</div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </Button>
      </div>
      {children}
    </div>
  );
}

function DroppableImageContainer({
  containerId,
  isEnabled,
  className,
  children,
}: {
  containerId: ImageContainerId;
  isEnabled: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `drop:${containerId}`,
    disabled: !isEnabled,
    data: {
      dropType: "image_container",
      targetContainer: containerId,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        isEnabled && isOver ? "ring-2 ring-primary/50 ring-offset-2 ring-offset-background" : ""
      )}
    >
      {children}
    </div>
  );
}

function DraggableImageCard({
  containerId,
  image,
  alt,
  imageClassName,
  badgeLabel,
  onRemove,
  footer,
}: {
  containerId: ImageContainerId;
  image: EditImageItem;
  alt: string;
  imageClassName: string;
  badgeLabel: string;
  onRemove: () => void;
  footer?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `drag:${containerId}:${image.id}`,
      data: {
        dragType: "image_item",
        sourceContainer: containerId,
        imageId: image.id,
      },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-muted",
        isDragging ? "opacity-70" : ""
      )}
    >
      <img src={image.previewUrl} alt={alt} className={imageClassName} loading="lazy" />
      <div className="absolute left-2 top-2 rounded bg-background/80 px-2 py-0.5 text-[10px] uppercase">
        {badgeLabel}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className="absolute bottom-2 left-2 h-7 w-7 cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className="absolute right-2 top-2 h-7 w-7"
        onClick={onRemove}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
      {footer}
    </div>
  );
}

function toNullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to read image"));
    };
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

async function toPayload(
  state: EditState,
  status?: ProductDraftStatus | null,
  url?: string | null
): Promise<ProductDraftPayload> {
  const existingUrls = state.images
    .filter((image) => image.type === "existing" && image.url)
    .map((image) => image.url as string);
  const newUrls = await Promise.all(
    state.images
      .filter((image) => image.type === "new" && image.file)
      .map((image) => fileToDataUrl(image.file as File))
  );
  const images = [...existingUrls, ...newUrls];

  const variations = await Promise.all(
    state.variations.map(async (variation) => {
      const existingVariationImages = variation.images
        .filter((image) => image.type === "existing" && image.url)
        .map((image) => image.url as string)
        .map((image) => image.trim())
        .filter((image) => image.length > 0);
      const newVariationImages = await Promise.all(
        variation.images
          .filter((image) => image.type === "new" && image.file)
          .map((image) => fileToDataUrl(image.file as File))
      );

      const positionValue = variation.position.trim();
      const positionNumber = positionValue.length ? Number(positionValue) : null;

      return {
        images: [...existingVariationImages, ...newVariationImages],
        position: Number.isFinite(positionNumber) ? positionNumber : null,
        title: toNullableString(variation.title),
      };
    })
  );

  return {
    title: toNullableString(state.title),
    description: toNullableString(state.description),
    currency: toNullableString(state.currency),
    price: toNullableString(state.price),
    images: images.length ? images : null,
    variations: variations.length ? variations : [],
    status: status ?? null,
    url: url ?? state.url ?? null,
  };
}

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
  const [isSaving, setIsSaving] = React.useState(false);
  const [activeDragType, setActiveDragType] = React.useState<DragKind>(null);
  const [variationImageUrlInputs, setVariationImageUrlInputs] = React.useState<
    Record<string, string>
  >({});

  const [editState, setEditState] = React.useState<EditState | null>(null);
  const editSnapshotRef = React.useRef<EditSnapshot | null>(null);
  const editStateRef = React.useRef<EditState | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const draftPayload = React.useMemo(() => draft?.draft ?? null, [draft]);

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

  const updateEditState = React.useCallback(
    (updater: (prev: EditState) => EditState) => {
      setEditState((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        const snapshot = editSnapshotRef.current;
        return snapshot ? { ...next, isDirty: computeIsDirty(next, snapshot) } : next;
      });
    },
    []
  );

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const onDragStart = React.useCallback((event: DragStartEvent) => {
    const dragType = event.active.data.current?.dragType;
    if (dragType === "variation_row" || dragType === "image_item") {
      setActiveDragType(dragType);
      return;
    }
    setActiveDragType(null);
  }, []);

  const onDragCancel = React.useCallback(() => {
    setActiveDragType(null);
  }, []);

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setActiveDragType(null);
      const { active, over } = event;
      const dragType = active.data.current?.dragType;
      if (!over) return;

      if (dragType === "image_item") {
        const sourceContainer = active.data.current?.sourceContainer;
        const imageId = active.data.current?.imageId;
        const targetContainer = over.data.current?.targetContainer;
        if (
          typeof sourceContainer !== "string" ||
          typeof imageId !== "string" ||
          typeof targetContainer !== "string"
        ) {
          return;
        }
        if (sourceContainer === targetContainer) return;

        updateEditState((prev) =>
          moveImageBetweenContainers(
            prev,
            sourceContainer as ImageContainerId,
            targetContainer as ImageContainerId,
            imageId
          )
        );
        return;
      }

      if (dragType !== "variation_row" || active.id === over.id) return;

      updateEditState((prev) => {
        const oldIndex = prev.variations.findIndex(
          (variation) => variation.id === String(active.id)
        );
        const newIndex = prev.variations.findIndex(
          (variation) => variation.id === String(over.id)
        );
        if (oldIndex < 0 || newIndex < 0) return prev;

        return {
          ...prev,
          variations: normalizeVariationPositions(
            arrayMove(prev.variations, oldIndex, newIndex)
          ),
        };
      });
    },
    [updateEditState]
  );

  React.useEffect(() => {
    if (!draftPayload) {
      setEditState((prev) => {
        revokeNewImagePreviews(prev);
        revokeNewVariationPreviews(prev);
        return null;
      });
      setVariationImageUrlInputs({});
      editSnapshotRef.current = null;
      return;
    }

    const snapshot = toEditSnapshot(draftPayload);
    editSnapshotRef.current = snapshot;
    setEditState((prev) => {
      revokeNewImagePreviews(prev);
      revokeNewVariationPreviews(prev);
      return createEditState(snapshot);
    });
    setVariationImageUrlInputs({});
  }, [draftPayload]);

  React.useEffect(() => {
    editStateRef.current = editState;
  }, [editState]);

  React.useEffect(() => {
    return () => {
      revokeNewImagePreviews(editStateRef.current);
      revokeNewVariationPreviews(editStateRef.current);
    };
  }, []);

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
      await rejectProductDraft(draftId, "");
      open?.({ type: "success", message: "Rejected" });
      await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      open?.({ type: "error", message: "Reject failed", description: message });
    } finally {
      setIsRejecting(false);
    }
  };

  const onSave = async () => {
    if (!draftId) return;
    if (!editState) return;
    if (!editSnapshotRef.current) return;

    setIsSaving(true);
    try {
      const payload = await toPayload(editState, draft?.status ?? null);
      const updated = await updateProductDraft(draftId, payload);
      editSnapshotRef.current = toEditSnapshot(updated.draft ?? payload);
      setEditState((prev) => {
        revokeNewImagePreviews(prev);
        return createEditState(editSnapshotRef.current as EditSnapshot);
      });
      open?.({ type: "success", message: "Draft updated" });
      await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      open?.({ type: "error", message: "Save failed", description: message });
    } finally {
      setIsSaving(false);
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
                  <Badge
                    variant={statusBadgeVariant(draft.status)}
                    className={statusBadgeClasses(draft.status)}
                  >
                    {statusLabel(draft.status)}
                  </Badge>
                  <Badge variant="outline">{progressPercent(draft.status)}%</Badge>
                </div>

                <div className="text-sm">
                  <div className="text-muted-foreground">Source URL</div>
                  {draft.draft?.url ? (
                    <a
                      className="break-all underline underline-offset-4"
                      href={draft.draft.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {draft.draft.url}
                    </a>
                  ) : (
                    <div className="text-muted-foreground">—</div>
                  )}
                </div>

                <div className="text-xs text-muted-foreground">
                  Updated: {new Date(draft.updated_at_ms).toLocaleString()}
                </div>
              </div>

              <Separator />

              {draft.status === "FAILED" && (
                <Alert variant="destructive">
                  <AlertTitle>Draft failed</AlertTitle>
                  <AlertDescription>
                    {draft.error ?? "No error message provided."}
                  </AlertDescription>
                </Alert>
              )}

              {draft.status === "REJECTED" && (
                <Alert>
                  <AlertTitle>Draft rejected</AlertTitle>
                  <AlertDescription>
                    No reason provided.
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
                        variant="outline"
                        onClick={() => {
                          if (!editSnapshotRef.current) return;
                          setEditState((prev) => {
                            revokeNewImagePreviews(prev);
                            revokeNewVariationPreviews(prev);
                            return createEditState(editSnapshotRef.current as EditSnapshot);
                          });
                        }}
                        disabled={!editState || !editState.isDirty}
                      >
                        Reset
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void onSave()}
                        disabled={!editState || !editState.isDirty || isSaving}
                      >
                        {isSaving ? "Saving..." : "Save changes"}
                      </Button>
                      <Button
                        onClick={() => void onPublish()}
                        disabled={
                          isPublishing || isRejecting || isSaving || !!editState?.isDirty
                        }
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

                  {editState ? (
                    <DndContext
                      sensors={dndSensors}
                      collisionDetection={closestCenter}
                      onDragStart={onDragStart}
                      onDragCancel={onDragCancel}
                      onDragEnd={onDragEnd}
                    >
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">Editable Draft</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="flex flex-col gap-4">
                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="flex flex-col gap-2">
                                  <Label htmlFor="draft-title">Title</Label>
                                  <Input
                                    id="draft-title"
                                    value={editState.title}
                                    onChange={(e) =>
                                      updateEditState((prev) => ({
                                        ...prev,
                                        title: e.target.value,
                                      }))
                                    }
                                    placeholder="Enter product title"
                                  />
                                </div>

                                <div className="flex flex-col gap-2">
                                  <Label htmlFor="draft-currency">Currency</Label>
                                  <Select
                                    value={editState.currency || undefined}
                                    onValueChange={(value) =>
                                      updateEditState((prev) => ({
                                        ...prev,
                                        currency: value,
                                      }))
                                    }
                                  >
                                    <SelectTrigger id="draft-currency">
                                      <SelectValue placeholder="Select currency" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {CURRENCY_OPTIONS.map((option) => (
                                        <SelectItem key={option} value={option}>
                                          {option}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="flex flex-col gap-2">
                                  <Label htmlFor="draft-price">Price</Label>
                                  <Input
                                    id="draft-price"
                                    type="number"
                                    step="0.01"
                                    inputMode="decimal"
                                    value={editState.price}
                                    onChange={(e) =>
                                      updateEditState((prev) => ({
                                        ...prev,
                                        price: e.target.value,
                                      }))
                                    }
                                    placeholder="0.00"
                                  />
                                </div>
                              </div>

                              <div className="flex flex-col gap-2">
                                <Label htmlFor="draft-description">Description</Label>
                                <Textarea
                                  id="draft-description"
                                  rows={8}
                                  value={editState.description}
                                  onChange={(e) =>
                                    updateEditState((prev) => ({
                                      ...prev,
                                      description: e.target.value,
                                    }))
                                  }
                                  placeholder="Describe the product"
                                />
                              </div>

                              <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between gap-2">
                                  <Label>Variations</Label>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    {editState.variations.length ? (
                                      <span>{editState.variations.length} item(s)</span>
                                    ) : (
                                      <span>No variations</span>
                                    )}
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        updateEditState((prev) => addVariation(prev))
                                      }
                                    >
                                      Add variation
                                    </Button>
                                  </div>
                                </div>

                                {editState.variations.length === 0 ? (
                                  <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                                    No variations. This product will be created without variants.
                                  </div>
                                ) : (
                                  <div className="flex flex-col gap-3">
                                    <SortableContext
                                      items={editState.variations.map((variation) => variation.id)}
                                      strategy={verticalListSortingStrategy}
                                    >
                                      {editState.variations.map((variation) => (
                                        <SortableVariationRow key={variation.id} id={variation.id}>
                                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                                            <div className="sm:col-span-7">
                                              <DroppableImageContainer
                                                containerId={toVariationContainerId(variation.id)}
                                                isEnabled={activeDragType === "image_item"}
                                                className="rounded-md p-1"
                                              >
                                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                                  {variation.images.map((image) => (
                                                    <DraggableImageCard
                                                      key={image.id}
                                                      containerId={toVariationContainerId(variation.id)}
                                                      image={image}
                                                      alt="Variation"
                                                      imageClassName="h-24 w-full object-cover"
                                                      badgeLabel={
                                                        image.type === "existing" ? "URL" : "Uploaded"
                                                      }
                                                      onRemove={() =>
                                                        updateEditState((prev) =>
                                                          removeVariationImage(
                                                            prev,
                                                            variation.id,
                                                            image.id
                                                          )
                                                        )
                                                      }
                                                      footer={
                                                        image.type === "existing" ? (
                                                          <div className="border-t bg-background p-1.5">
                                                            <Input
                                                              value={image.url ?? ""}
                                                              placeholder="https://..."
                                                              className="h-7 text-xs"
                                                              onChange={(e) =>
                                                                updateEditState((prev) =>
                                                                  updateVariationImageUrl(
                                                                    prev,
                                                                    variation.id,
                                                                    image.id,
                                                                    e.target.value
                                                                  )
                                                                )
                                                              }
                                                            />
                                                          </div>
                                                        ) : undefined
                                                      }
                                                    />
                                                  ))}
                                                  <button
                                                    type="button"
                                                    className={cn(
                                                      "flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-[11px] text-muted-foreground transition-colors",
                                                      "hover:border-primary hover:text-foreground"
                                                    )}
                                                    onClick={() => {
                                                      const input = document.createElement("input");
                                                      input.type = "file";
                                                      input.accept = "image/*";
                                                      input.multiple = true;
                                                      input.onchange = (event) => {
                                                        const files = Array.from(
                                                          (event.target as HTMLInputElement).files ??
                                                            []
                                                        );
                                                        if (files.length) {
                                                          updateEditState((prev) =>
                                                            addVariationImagesFromFile(
                                                              prev,
                                                              variation.id,
                                                              files
                                                            )
                                                          );
                                                        }
                                                      };
                                                      input.click();
                                                    }}
                                                    onDragOver={(event) => {
                                                      event.preventDefault();
                                                    }}
                                                    onDrop={(event) => {
                                                      event.preventDefault();
                                                      const files = Array.from(
                                                        event.dataTransfer.files
                                                      );
                                                      updateEditState((prev) =>
                                                        addVariationImagesFromFile(
                                                          prev,
                                                          variation.id,
                                                          files
                                                        )
                                                      );
                                                    }}
                                                  >
                                                    <ImagePlus className="h-4 w-4" />
                                                    Add image(s)
                                                  </button>
                                                </div>
                                              </DroppableImageContainer>
                                            </div>

                                            <div className="sm:col-span-3 flex flex-col gap-1">
                                              <Label className="text-xs">Title</Label>
                                              <Input
                                                value={variation.title}
                                                placeholder="Variation title"
                                                onChange={(e) =>
                                                  updateEditState((prev) =>
                                                    updateVariationField(
                                                      prev,
                                                      variation.id,
                                                      (item) => ({
                                                        ...item,
                                                        title: e.target.value,
                                                      })
                                                    )
                                                  )
                                                }
                                              />
                                            </div>

                                            <div className="sm:col-span-2 flex flex-col gap-1">
                                              <Label className="text-xs">Position</Label>
                                              <Input
                                                value={variation.position}
                                                type="number"
                                                inputMode="numeric"
                                                readOnly
                                              />
                                              <div className="text-[10px] text-muted-foreground">
                                                Drag to reorder (0-based)
                                              </div>
                                            </div>
                                          </div>

                                          <div className="flex flex-wrap items-center gap-2">
                                            <Input
                                              placeholder="Add image URL"
                                              value={variationImageUrlInputs[variation.id] ?? ""}
                                              onChange={(e) =>
                                                setVariationImageUrlInputs((prev) => ({
                                                  ...prev,
                                                  [variation.id]: e.target.value,
                                                }))
                                              }
                                              className="h-8 max-w-sm"
                                            />
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              className="whitespace-nowrap"
                                              onClick={() => {
                                                const nextUrl =
                                                  variationImageUrlInputs[variation.id] ?? "";
                                                if (!nextUrl.trim().length) return;
                                                updateEditState((prev) =>
                                                  addVariationImageFromUrl(
                                                    prev,
                                                    variation.id,
                                                    nextUrl
                                                  )
                                                );
                                                setVariationImageUrlInputs((prev) => ({
                                                  ...prev,
                                                  [variation.id]: "",
                                                }));
                                              }}
                                            >
                                              Add URL
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="destructive"
                                              size="sm"
                                              onClick={() =>
                                                updateEditState((prev) =>
                                                  removeVariation(prev, variation)
                                                )
                                              }
                                            >
                                              Remove variation
                                            </Button>
                                          </div>
                                        </SortableVariationRow>
                                      ))}
                                    </SortableContext>
                                  </div>
                                )}
                              </div>

                            </div>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">Images</CardTitle>
                          </CardHeader>
                          <CardContent className="flex flex-col gap-2">
                            <DroppableImageContainer
                              containerId="main"
                              isEnabled={activeDragType === "image_item"}
                              className="flex min-h-[28rem] flex-col gap-2 rounded-lg border border-dashed p-3 sm:min-h-[32rem]"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <Label>Images</Label>
                                <div className="text-xs text-muted-foreground">
                                  {editState.images.length} image(s)
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {editState.images.map((image) => (
                                  <DraggableImageCard
                                    key={image.id}
                                    containerId="main"
                                    image={image}
                                    alt="Draft"
                                    imageClassName="h-32 w-full object-cover"
                                    badgeLabel={image.type === "existing" ? "Original" : "New"}
                                    onRemove={() =>
                                      updateEditState((prev) => removeImage(prev, image))
                                    }
                                  />
                                ))}
                                <button
                                  type="button"
                                  className={cn(
                                    "flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-xs text-muted-foreground transition-colors",
                                    "hover:border-primary hover:text-foreground"
                                  )}
                                  onClick={() => fileInputRef.current?.click()}
                                  onDragOver={(event) => {
                                    event.preventDefault();
                                  }}
                                  onDrop={(event) => {
                                    event.preventDefault();
                                    const files = Array.from(event.dataTransfer.files);
                                    updateEditState((prev) => addImages(prev, files));
                                  }}
                                >
                                  <ImagePlus className="h-5 w-5" />
                                  Drag & drop or click
                                </button>
                              </div>
                              <div
                                className={cn(
                                  "flex min-h-24 items-center justify-center rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground",
                                  activeDragType === "image_item"
                                    ? "border-primary/50 bg-primary/5 text-foreground"
                                    : "bg-muted/20"
                                )}
                              >
                                Drop variation images anywhere in this area
                              </div>
                            </DroppableImageContainer>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/*"
                              multiple
                              className="hidden"
                              onChange={(event) => {
                                const files = Array.from(event.target.files ?? []);
                                event.target.value = "";
                                updateEditState((prev) => addImages(prev, files));
                              }}
                            />
                          </CardContent>
                        </Card>
                      </div>
                    </DndContext>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Draft payload is not available yet.
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </ListView>
  );
}
