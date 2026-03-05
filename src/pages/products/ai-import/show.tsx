import { useNotification } from "@refinedev/core";
import {
  closestCenter,
  pointerWithin,
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
  deleteProductDraft,
  getProductDraft,
  isTerminalStatus,
  publishProductDraft,
  rejectProductDraft,
  searchCategoryTaxonomy,
  updateProductDraft,
  type CategoryTaxonomyCandidate,
  type ProductDraft,
  type ProductDraftPayload,
  type ProductDraftStatus,
} from "@/lib/admin-ai-product-drafts";
import { canonicalizeProductUrl } from "@/lib/canonicalize-product-url";
import {
  aiEditImage,
  DEFAULT_GEMINI_IMAGE_EDIT_MODEL,
  GEMINI_IMAGE_EDIT_MODELS,
  type GeminiImageEditModel,
  PROMPT_REMOVE_BACKGROUND,
  PROMPT_REMOVE_CHINESE_TEXT,
} from "@/lib/gemini-image-edit";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { Download, GripVertical, ImagePlus, Loader2, Trash2, X } from "lucide-react";

type EditSnapshot = {
  categoryIds: number[];
  categoryBranch: CategoryBranchItem[];
  title: string;
  description: string;
  currency: string;
  price: string;
  taxRate: string;
  shippingFee: string;
  imageUrls: string[];
  mainImageRef: SnapshotMainImageRef;
  url: string;
  variationSnapshots: VariationSnapshotItem[];
};

type EditImageItem = {
  id: string;
  type: "existing" | "new" | "uploaded";
  url?: string;
  file?: File;
  previewUrl: string;
};

type VariationSnapshotItem = {
  imageUrls: string[];
  position: string;
  price: string;
  title: string;
};

type EditVariationItem = {
  id: string;
  title: string;
  position: string;
  price: string;
  images: EditImageItem[];
};

type SelectedCategoryPreview = {
  leafLabel: string;
  branchPath: string;
};

type CategoryBranchItem = {
  id: number;
  tier: number | null;
  isLeaf: boolean;
};

type ImageContainerId = "main" | `variation:${string}`;
type SnapshotMainImageRef = {
  container: "main" | "variation";
  variationPosition: number | null;
  url: string;
} | null;
type MainImageSelection = {
  containerId: ImageContainerId;
  imageId: string;
} | null;
type DragKind = "variation_row" | "image_item" | null;
type ImageAiEditMode = "remove_chinese_text" | "remove_background";
type AiEditPreviewState = {
  containerId: ImageContainerId;
  imageId: string;
  mode: ImageAiEditMode;
  originalUrl: string;
  processedPreviewUrl: string;
  processedFile: File;
};

function imageAiEditModeLabel(mode: ImageAiEditMode): string {
  return mode === "remove_chinese_text" ? "Remove Chinese Text" : "Remove Background";
}

type EditState = EditSnapshot & {
  images: EditImageItem[];
  mainImageSelection: MainImageSelection;
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
const AI_IMAGE_MODEL_STORAGE_KEY = "peasydeal_admin_ai_image_model";

function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveVariationPrice(
  rawPrice: string | number | null | undefined,
  fallbackPrice: string
): string {
  if (typeof rawPrice === "number" || typeof rawPrice === "string") {
    const normalized = String(rawPrice).trim();
    if (normalized.length > 0) return normalized;
  }

  const fallback = fallbackPrice.trim();
  return fallback.length > 0 ? fallback : "";
}

function resolveDecimalString(
  raw: string | number | null | undefined,
  fallback: string
): string {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? String(raw) : fallback;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : fallback;
  }
  return fallback;
}

function uniqueStringArray(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed.length || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

function uniqueNumberArray(values: number[]): number[] {
  const seen = new Set<number>();
  const next: number[] = [];
  for (const value of values) {
    if (!Number.isFinite(value) || seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

function toCategoryIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];

  const parsed = raw
    .map((item) => {
      if (typeof item === "number") return item;
      if (typeof item === "string") return Number(item);
      return NaN;
    })
    .filter((item) => Number.isFinite(item));

  return uniqueNumberArray(parsed);
}

function buildCategoryBranchFromIds(ids: number[]): CategoryBranchItem[] {
  return ids.map((id, index) => ({
    id,
    tier: null,
    isLeaf: index === ids.length - 1,
  }));
}

function toCategoryBranch(raw: unknown): CategoryBranchItem[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<number>();
  const parsed: CategoryBranchItem[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const idRaw = record.id;
    const tierRaw = record.tier;
    const id =
      typeof idRaw === "number"
        ? idRaw
        : typeof idRaw === "string"
          ? Number(idRaw)
          : NaN;

    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);

    const tier =
      typeof tierRaw === "number"
        ? (Number.isFinite(tierRaw) ? tierRaw : null)
        : typeof tierRaw === "string"
          ? (Number.isFinite(Number(tierRaw)) ? Number(tierRaw) : null)
          : null;

    parsed.push({
      id,
      tier,
      isLeaf: record.is_leaf === true,
    });
  }

  if (!parsed.length) return [];

  const explicitLeafIndex = parsed.findIndex((item) => item.isLeaf);
  const leafIndex = explicitLeafIndex >= 0 ? explicitLeafIndex : parsed.length - 1;

  return parsed.map((item, index) => ({
    ...item,
    isLeaf: index === leafIndex,
  }));
}

function fileSignature(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}|${file.type}`;
}

function isUploadedImageType(image: Pick<EditImageItem, "type">): boolean {
  return image.type === "new" || image.type === "uploaded";
}

function imageDedupKey(image: Pick<EditImageItem, "type" | "url" | "file">): string | null {
  if (image.type === "existing" && typeof image.url === "string") {
    const trimmed = image.url.trim();
    return trimmed.length ? `url:${trimmed}` : null;
  }

  if (isUploadedImageType(image) && image.file) {
    return `file:${fileSignature(image.file)}`;
  }

  return null;
}

function hasDuplicateImage(
  images: EditImageItem[],
  target: Pick<EditImageItem, "type" | "url" | "file">
): boolean {
  const targetKey = imageDedupKey(target);
  if (!targetKey) return false;
  return images.some((image) => imageDedupKey(image) === targetKey);
}

function sameMainImageRef(
  a: SnapshotMainImageRef,
  b: SnapshotMainImageRef
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return (
    a.container === b.container &&
    a.variationPosition === b.variationPosition &&
    a.url === b.url
  );
}

function getFallbackMainImageRef(
  imageUrls: string[],
  variationSnapshots: VariationSnapshotItem[]
): SnapshotMainImageRef {
  const firstMain = imageUrls.find((item) => item.trim().length > 0);
  if (firstMain) {
    return { container: "main", variationPosition: null, url: firstMain };
  }

  for (const variation of variationSnapshots) {
    const firstVariationImage = variation.imageUrls.find((item) => item.trim().length > 0);
    if (!firstVariationImage) continue;
    return {
      container: "variation",
      variationPosition: toNumberOrNull(variation.position),
      url: firstVariationImage,
    };
  }

  return null;
}

function resolveSnapshotMainImageRef(
  imageUrls: string[],
  variationSnapshots: VariationSnapshotItem[],
  raw: ProductDraftPayload["main_image_ref"]
): SnapshotMainImageRef {
  const container = raw?.container;
  const url = typeof raw?.url === "string" ? raw.url.trim() : "";
  const variationPosition =
    typeof raw?.variation_position === "number" && Number.isFinite(raw.variation_position)
      ? raw.variation_position
      : null;

  if (container === "main" && url.length > 0 && imageUrls.includes(url)) {
    return {
      container: "main",
      variationPosition: null,
      url,
    };
  }

  if (container === "variation" && url.length > 0 && variationPosition != null) {
    const variation = variationSnapshots.find(
      (item) => toNumberOrNull(item.position) === variationPosition
    );
    if (variation && variation.imageUrls.includes(url)) {
      return {
        container: "variation",
        variationPosition,
        url,
      };
    }
  }

  return getFallbackMainImageRef(imageUrls, variationSnapshots);
}

function toEditSnapshot(payload: ProductDraftPayload): EditSnapshot {
  const topLevelPrice =
    typeof payload.price === "number" || typeof payload.price === "string"
      ? String(payload.price)
      : "";

  const imageUrls = Array.isArray(payload.images)
    ? uniqueStringArray(
        payload.images.filter((item): item is string => typeof item === "string")
      )
    : [];

  const variationSnapshots = Array.isArray(payload.variations)
    ? payload.variations.map((item) => ({
        imageUrls:
          item && Array.isArray(item.images)
            ? item.images.filter((image): image is string => typeof image === "string")
            : [],
        position:
          item && (typeof item.position === "number" || typeof item.position === "string")
            ? String(item.position)
            : "",
        price: resolveVariationPrice(item?.price, topLevelPrice),
        title: item && typeof item.title === "string" ? item.title : "",
      }))
    : [];

  const rawMainImageRef = payload.main_image_ref;
  const resolvedMainImageRef = resolveSnapshotMainImageRef(
    imageUrls,
    variationSnapshots,
    rawMainImageRef
  );
  const parsedCategoryIds = toCategoryIds(payload.category_ids);
  const parsedCategoryBranch = toCategoryBranch(payload.category_branch);
  const categoryIds = parsedCategoryIds.length
    ? parsedCategoryIds
    : parsedCategoryBranch.map((item) => item.id);
  const categoryBranch = parsedCategoryBranch.length
    ? parsedCategoryBranch
    : buildCategoryBranchFromIds(categoryIds);

  return {
    categoryIds,
    categoryBranch,
    title: typeof payload.title === "string" ? payload.title : "",
    description: typeof payload.description === "string" ? payload.description : "",
    currency: typeof payload.currency === "string" ? payload.currency : "",
    price: topLevelPrice,
    taxRate: resolveDecimalString(payload.tax_rate, "0"),
    shippingFee: resolveDecimalString(payload.shipping_fee, "0"),
    imageUrls,
    mainImageRef: resolvedMainImageRef,
    url: typeof payload.url === "string" ? payload.url : "",
    variationSnapshots,
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
    price: variation.price,
    images: variation.imageUrls.map((url) => ({
      id: newId(),
      type: "existing" as const,
      url,
      previewUrl: url,
    })),
  }));

  const mainImageSelection = findMainImageSelectionFromSnapshot(
    images,
    variations,
    snapshot.mainImageRef
  );

  return normalizeMainImageSelection({
    ...snapshot,
    images,
    mainImageSelection,
    variations,
    isDirty: false,
  });
}

function isSameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isSameNumberArray(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isSameCategoryBranch(a: CategoryBranchItem[], b: CategoryBranchItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].tier !== b[i].tier) return false;
    if (a[i].isLeaf !== b[i].isLeaf) return false;
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
  const normalizedState = normalizeMainImageSelection(state);

  if (!isSameNumberArray(normalizedState.categoryIds, snapshot.categoryIds)) return true;
  if (!isSameCategoryBranch(normalizedState.categoryBranch, snapshot.categoryBranch)) return true;
  if (normalizedState.title !== snapshot.title) return true;
  if (normalizedState.description !== snapshot.description) return true;
  if (normalizedState.currency !== snapshot.currency) return true;
  if (normalizedState.price !== snapshot.price) return true;
  if (normalizedState.taxRate !== snapshot.taxRate) return true;
  if (normalizedState.shippingFee !== snapshot.shippingFee) return true;
  if (normalizedState.url !== snapshot.url) return true;
  if (normalizedState.images.some((image) => isUploadedImageType(image))) return true;
  const existingUrls = normalizedState.images
    .filter((image) => image.type === "existing" && image.url)
    .map((image) => image.url as string);
  if (!isSameStringArray(existingUrls, snapshot.imageUrls)) return true;

  if (normalizedState.variations.length !== snapshot.variationSnapshots.length) return true;
  for (let i = 0; i < normalizedState.variations.length; i += 1) {
    const current = normalizedState.variations[i];
    const original = snapshot.variationSnapshots[i];
    if (!original) return true;
    if (current.images.some((image) => isUploadedImageType(image))) return true;
    const currentImageUrls = current.images
      .filter((image) => image.type === "existing" && image.url)
      .map((image) => image.url as string);
    if (!isSameStringArray(currentImageUrls, original.imageUrls)) return true;
    if (current.title !== original.title) return true;
    if (current.position !== original.position) return true;
    if (current.price !== original.price) return true;
  }

  if (!sameMainImageRef(getMainImageRefFromState(normalizedState), snapshot.mainImageRef)) {
    return true;
  }

  return false;
}

function revokeNewImagePreviews(state: EditState | null) {
  if (!state) return;
  state.images.forEach((image) => {
    if (isUploadedImageType(image)) {
      URL.revokeObjectURL(image.previewUrl);
    }
  });
}

function revokeNewVariationPreviews(state: EditState | null) {
  if (!state) return;
  state.variations.forEach((variation) => {
    variation.images.forEach((image) => {
      if (isUploadedImageType(image)) {
        URL.revokeObjectURL(image.previewUrl);
      }
    });
  });
}

function addImages(state: EditState, files: File[]): EditState {
  const existingKeys = new Set(
    state.images
      .map((image) => imageDedupKey(image))
      .filter((key): key is string => typeof key === "string")
  );
  const batchKeys = new Set<string>();
  const nextImages = files
    .filter((file) => file.type.startsWith("image/"))
    .filter((file) => {
      const key = `file:${fileSignature(file)}`;
      if (existingKeys.has(key) || batchKeys.has(key)) return false;
      batchKeys.add(key);
      return true;
    })
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
  if (isUploadedImageType(image)) {
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
    price: state.price.trim(),
    images: [],
  };

  return {
    ...state,
    variations: normalizeVariationPositions([...state.variations, item]),
  };
}

function removeVariation(state: EditState, variation: EditVariationItem): EditState {
  variation.images.forEach((image) => {
    if (isUploadedImageType(image)) {
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
      if (target && isUploadedImageType(target)) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return {
        ...item,
        images: item.images.filter((image) => image.id !== imageId),
      };
    }),
  };
}

function replaceImageWithUploaded(
  state: EditState,
  containerId: ImageContainerId,
  imageId: string,
  file: File,
  previewUrl: string
): EditState {
  const replacement: EditImageItem = {
    id: imageId,
    type: "uploaded",
    file,
    previewUrl,
  };

  if (containerId === "main") {
    let replaced = false;
    const images = state.images.map((image) => {
      if (image.id !== imageId) return image;
      replaced = true;
      if (isUploadedImageType(image)) {
        URL.revokeObjectURL(image.previewUrl);
      }
      return replacement;
    });
    return replaced ? { ...state, images } : state;
  }

  const variationId = getVariationId(containerId);
  if (!variationId) return state;

  let replaced = false;
  const variations = state.variations.map((variation) => {
    if (variation.id !== variationId) return variation;
    return {
      ...variation,
      images: variation.images.map((image) => {
        if (image.id !== imageId) return image;
        replaced = true;
        if (isUploadedImageType(image)) {
          URL.revokeObjectURL(image.previewUrl);
        }
        return replacement;
      }),
    };
  });

  return replaced ? { ...state, variations } : state;
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

function getFirstMainImageSelection(state: EditState): MainImageSelection {
  if (state.images.length > 0) {
    return {
      containerId: "main",
      imageId: state.images[0].id,
    };
  }

  for (const variation of state.variations) {
    if (variation.images.length > 0) {
      return {
        containerId: toVariationContainerId(variation.id),
        imageId: variation.images[0].id,
      };
    }
  }

  return null;
}

function findImageContainerById(
  state: Pick<EditState, "images" | "variations">,
  imageId: string
): ImageContainerId | null {
  if (state.images.some((image) => image.id === imageId)) return "main";

  for (const variation of state.variations) {
    if (variation.images.some((image) => image.id === imageId)) {
      return toVariationContainerId(variation.id);
    }
  }

  return null;
}

function isImageInContainer(
  state: Pick<EditState, "images" | "variations">,
  containerId: ImageContainerId,
  imageId: string
): boolean {
  if (containerId === "main") {
    return state.images.some((image) => image.id === imageId);
  }

  const variationId = getVariationId(containerId);
  if (!variationId) return false;
  const variation = state.variations.find((item) => item.id === variationId);
  if (!variation) return false;
  return variation.images.some((image) => image.id === imageId);
}

function normalizeMainImageSelection(state: EditState): EditState {
  const selection = state.mainImageSelection;
  if (!selection) {
    return {
      ...state,
      mainImageSelection: getFirstMainImageSelection(state),
    };
  }

  if (isImageInContainer(state, selection.containerId, selection.imageId)) {
    return state;
  }

  const movedContainerId = findImageContainerById(state, selection.imageId);
  if (movedContainerId) {
    return {
      ...state,
      mainImageSelection: {
        containerId: movedContainerId,
        imageId: selection.imageId,
      },
    };
  }

  return {
    ...state,
    mainImageSelection: getFirstMainImageSelection(state),
  };
}

function getMainImageRefFromState(state: EditState): SnapshotMainImageRef {
  const normalized = normalizeMainImageSelection(state);
  const selection = normalized.mainImageSelection;
  if (!selection) return null;

  if (selection.containerId === "main") {
    const image = normalized.images.find((item) => item.id === selection.imageId);
    if (!image || typeof image.url !== "string") return null;
    const url = image.url.trim();
    if (!url.length) return null;
    return {
      container: "main",
      variationPosition: null,
      url,
    };
  }

  const variationId = getVariationId(selection.containerId);
  if (!variationId) return null;
  const variation = normalized.variations.find((item) => item.id === variationId);
  if (!variation) return null;
  const image = variation.images.find((item) => item.id === selection.imageId);
  if (!image || typeof image.url !== "string") return null;
  const url = image.url.trim();
  if (!url.length) return null;

  return {
    container: "variation",
    variationPosition: toNumberOrNull(variation.position),
    url,
  };
}

function findMainImageSelectionFromSnapshot(
  images: EditImageItem[],
  variations: EditVariationItem[],
  mainImageRef: SnapshotMainImageRef
): MainImageSelection {
  if (mainImageRef?.container === "main") {
    const image = images.find((item) => item.url === mainImageRef.url);
    if (image) {
      return {
        containerId: "main",
        imageId: image.id,
      };
    }
  }

  if (mainImageRef?.container === "variation") {
    const variation = variations.find(
      (item) => toNumberOrNull(item.position) === mainImageRef.variationPosition
    );
    const image = variation?.images.find((item) => item.url === mainImageRef.url);
    if (variation && image) {
      return {
        containerId: toVariationContainerId(variation.id),
        imageId: image.id,
      };
    }
  }

  if (images.length > 0) {
    return {
      containerId: "main",
      imageId: images[0].id,
    };
  }

  for (const variation of variations) {
    if (variation.images.length > 0) {
      return {
        containerId: toVariationContainerId(variation.id),
        imageId: variation.images[0].id,
      };
    }
  }

  return null;
}

function isMainImageSelection(
  selection: MainImageSelection,
  containerId: ImageContainerId,
  imageId: string
): boolean {
  return (
    selection?.containerId === containerId &&
    selection?.imageId === imageId
  );
}

function getSelectedVariationImage(
  variation: EditVariationItem,
  selectedImageId?: string
): EditImageItem | null {
  if (!variation.images.length) return null;
  if (selectedImageId) {
    const selected = variation.images.find((image) => image.id === selectedImageId);
    if (selected) return selected;
  }
  return variation.images[0];
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
    const shouldAppend = !hasDuplicateImage(state.images, image);
    return {
      ...state,
      images: shouldAppend ? [...state.images, image] : state.images,
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

async function downloadImage(url: string, filename?: string) {
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) throw new Error("Failed to fetch image");
    const blob = await response.blob();
    const ext =
      blob.type === "image/png"
        ? ".png"
        : blob.type === "image/webp"
          ? ".webp"
          : ".jpg";
    const name = filename ?? `image_${Date.now()}${ext}`;
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(blobUrl);
  } catch {
    // Fallback: open in new tab if CORS blocks the fetch
    window.open(url, "_blank");
  }
}

function DraggableImageCard({
  containerId,
  image,
  alt,
  imageClassName,
  badgeLabel,
  resolutionText,
  isMain,
  onRemove,
  onSetMain,
  onPreview,
  onAiEdit,
  onSelect,
  interactionMode = "preview",
  isSelected = false,
  showInlineSetMain = true,
  showInlineRemove = true,
  footer,
}: {
  containerId: ImageContainerId;
  image: EditImageItem;
  alt: string;
  imageClassName: string;
  badgeLabel: string;
  resolutionText?: string;
  isMain: boolean;
  onRemove?: () => void;
  onSetMain?: (image: EditImageItem) => void;
  onPreview: (image: EditImageItem) => void;
  onAiEdit?: (
    containerId: ImageContainerId,
    image: EditImageItem,
    mode: ImageAiEditMode
  ) => Promise<void> | void;
  onSelect?: (image: EditImageItem) => void;
  interactionMode?: "preview" | "select";
  isSelected?: boolean;
  showInlineSetMain?: boolean;
  showInlineRemove?: boolean;
  footer?: React.ReactNode;
}) {
  const pointerDownRef = React.useRef<{ x: number; y: number } | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);
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
  const isInteractionDisabled = isProcessing;

  const handleAiEdit = React.useCallback(
    async (mode: ImageAiEditMode) => {
      if (!onAiEdit || isProcessing) return;
      setIsProcessing(true);
      try {
        await onAiEdit(containerId, image, mode);
      } finally {
        setIsProcessing(false);
      }
    },
    [containerId, image, isProcessing, onAiEdit]
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          className={cn(
            "group relative overflow-hidden rounded-lg border bg-muted",
            isMain ? "border-amber-400 ring-2 ring-amber-300 ring-offset-2 ring-offset-background" : "",
            isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "",
            isDragging ? "opacity-70" : ""
          )}
        >
          {isMain ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-amber-400/95 py-1 text-center text-[10px] font-semibold tracking-[0.12em] text-amber-950">
              MAIN IMAGE
            </div>
          ) : null}
          <img
            src={image.previewUrl}
            alt={alt}
            className={cn(
              imageClassName,
              isInteractionDisabled
                ? "cursor-progress"
                : "cursor-grab active:cursor-grabbing"
            )}
            loading="lazy"
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (isInteractionDisabled) return;
              pointerDownRef.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerCancel={() => {
              pointerDownRef.current = null;
            }}
            onClick={(event) => {
              if (isDragging || isInteractionDisabled) return;
              const pointerDown = pointerDownRef.current;
              pointerDownRef.current = null;
              if (interactionMode === "select") {
                onSelect?.(image);
                return;
              }
              if (!pointerDown) {
                onPreview(image);
                return;
              }
              const dx = Math.abs(event.clientX - pointerDown.x);
              const dy = Math.abs(event.clientY - pointerDown.y);
              if (dx > 6 || dy > 6) return;
              onPreview(image);
            }}
            {...(isInteractionDisabled ? {} : attributes)}
            {...(isInteractionDisabled ? {} : listeners)}
          />
          {isProcessing ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/65">
              <div className="flex items-center gap-2 rounded-md bg-background/90 px-2 py-1 text-xs text-foreground shadow">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Processing
              </div>
            </div>
          ) : null}
          <div className="absolute left-2 top-2 rounded bg-background/80 px-2 py-0.5 text-[10px] uppercase">
            {badgeLabel}
          </div>
          <div className="absolute bottom-2 left-2">
            {isMain ? (
              <Badge className="h-5 px-2 text-[10px]">Main</Badge>
            ) : showInlineSetMain ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-6 px-2 text-[10px]"
                disabled={isInteractionDisabled}
                onClick={() => onSetMain?.(image)}
              >
                Set as main
              </Button>
            ) : null}
          </div>
          {showInlineRemove ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className={cn(
                "absolute right-2 h-7 w-7",
                isMain ? "top-8" : "top-2",
                "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              )}
              disabled={isInteractionDisabled}
              onClick={() => onRemove?.()}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <div
            className={cn(
              "absolute bottom-2 right-2 rounded bg-background/85 px-2 py-0.5 text-[10px]",
              "text-foreground"
            )}
          >
            {resolutionText ?? "—"}
          </div>
          {footer}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={isInteractionDisabled}
          onClick={() => void downloadImage(image.previewUrl)}
        >
          <Download className="mr-2 h-4 w-4" />
          Download
        </ContextMenuItem>
        <ContextMenuSeparator />
        {onAiEdit ? (
          <>
            <ContextMenuItem
              disabled={isInteractionDisabled}
              onClick={() => void handleAiEdit("remove_chinese_text")}
            >
              ✨ Remove Chinese Text
            </ContextMenuItem>
            <ContextMenuItem
              disabled={isInteractionDisabled}
              onClick={() => void handleAiEdit("remove_background")}
            >
              🪄 Remove Background
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        {!isMain && onSetMain ? (
          <ContextMenuItem
            disabled={isInteractionDisabled}
            onClick={() => onSetMain(image)}
          >
            Set as main image
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          disabled={isInteractionDisabled}
          onClick={() => onPreview(image)}
        >
          Preview
        </ContextMenuItem>
        {onRemove ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={isInteractionDisabled}
              variant="destructive"
              onClick={() => onRemove()}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

async function readImageResolution(imageUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve(`${image.naturalWidth}x${image.naturalHeight}`);
    };
    image.onerror = () => {
      resolve("—");
    };
    image.src = imageUrl;
  });
}

function toNullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function toNonNegativeNumberOrZero(value: string): number {
  const parsed = toNumberOrNull(value);
  if (parsed == null) return 0;
  return parsed < 0 ? 0 : parsed;
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
  const normalizedState = normalizeMainImageSelection(state);
  const categoryIds = normalizedState.categoryIds.length
    ? normalizedState.categoryIds
    : normalizedState.categoryBranch.map((item) => item.id);
  const categoryBranch = normalizedState.categoryBranch.length
    ? normalizedState.categoryBranch
    : buildCategoryBranchFromIds(categoryIds);

  const mainImageEntries = await Promise.all(
    normalizedState.images.map(async (image) => {
      if (image.type === "existing" && typeof image.url === "string") {
        const trimmed = image.url.trim();
        return { id: image.id, url: trimmed.length ? trimmed : null };
      }
      if (isUploadedImageType(image) && image.file) {
        return { id: image.id, url: await fileToDataUrl(image.file) };
      }
      return { id: image.id, url: null };
    })
  );
  const images = mainImageEntries
    .map((item) => item.url)
    .filter((item): item is string => typeof item === "string" && item.length > 0);

  const variations = await Promise.all(
    normalizedState.variations.map(async (variation) => {
      const imageEntries = await Promise.all(
        variation.images.map(async (image) => {
          if (image.type === "existing" && typeof image.url === "string") {
            const trimmed = image.url.trim();
            return { id: image.id, url: trimmed.length ? trimmed : null };
          }
          if (isUploadedImageType(image) && image.file) {
            return { id: image.id, url: await fileToDataUrl(image.file) };
          }
          return { id: image.id, url: null };
        })
      );

      const positionNumber = toNumberOrNull(variation.position);

      return {
        variationId: variation.id,
        images: imageEntries
          .map((item) => item.url)
          .filter((item): item is string => typeof item === "string" && item.length > 0),
        imageEntries,
        position: positionNumber,
        price: toNullableString(resolveVariationPrice(variation.price, normalizedState.price)),
        title: toNullableString(variation.title),
      };
    })
  );

  const selection = normalizedState.mainImageSelection;
  let mainImageRef: ProductDraftPayload["main_image_ref"] = null;
  if (selection) {
    if (selection.containerId === "main") {
      const target = mainImageEntries.find((item) => item.id === selection.imageId);
      if (target?.url) {
        mainImageRef = {
          container: "main",
          variation_position: null,
          url: target.url,
        };
      }
    } else {
      const variationId = getVariationId(selection.containerId);
      const targetVariation = variations.find(
        (variation) => variationId != null && variation.variationId === variationId
      );
      const target = targetVariation?.imageEntries.find(
        (item) => item.id === selection.imageId
      );
      if (target?.url && targetVariation) {
        mainImageRef = {
          container: "variation",
          variation_position: targetVariation.position,
          url: target.url,
        };
      }
    }
  }

  if (!mainImageRef) {
    const fallbackMain = mainImageEntries.find((item) => item.url);
    if (fallbackMain?.url) {
      mainImageRef = {
        container: "main",
        variation_position: null,
        url: fallbackMain.url,
      };
    } else {
      const fallbackVariation = variations.find((variation) =>
        variation.imageEntries.some((item) => item.url)
      );
      const fallbackVariationImage = fallbackVariation?.imageEntries.find((item) => item.url);
      if (fallbackVariation?.position != null && fallbackVariationImage?.url) {
        mainImageRef = {
          container: "variation",
          variation_position: fallbackVariation.position,
          url: fallbackVariationImage.url,
        };
      }
    }
  }

  const rawUrl = url ?? normalizedState.url ?? null;
  const normalizedUrl =
    typeof rawUrl === "string" ? canonicalizeProductUrl(rawUrl) : rawUrl;

  return {
    category_ids: categoryIds.length ? categoryIds : null,
    category_branch: categoryBranch.length
      ? categoryBranch.map((item) => ({
          id: item.id,
          tier: item.tier,
          is_leaf: item.isLeaf,
        }))
      : null,
    title: toNullableString(normalizedState.title),
    description: toNullableString(normalizedState.description),
    currency: toNullableString(normalizedState.currency),
    price: toNullableString(normalizedState.price),
    tax_rate: toNonNegativeNumberOrZero(normalizedState.taxRate),
    shipping_fee: toNonNegativeNumberOrZero(normalizedState.shippingFee),
    images: images.length ? images : null,
    variations: variations.map((variation) => ({
      images: variation.images,
      position: variation.position,
      price: variation.price,
      title: variation.title,
    })),
    main_image_ref: mainImageRef,
    status: status ?? null,
    url: normalizedUrl,
  };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized.length) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isUsableImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.length) return false;

  try {
    const url = new URL(trimmed);
    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "data:"
    );
  } catch {
    return false;
  }
}

function validatePublishPayload(
  draftId: string,
  payload: ProductDraftPayload & { draft_id: string }
): string | null {
  if (payload.draft_id !== draftId) {
    return "Draft ID mismatch.";
  }

  if (typeof payload.shipping_fee !== "number" || !Number.isFinite(payload.shipping_fee)) {
    return "Shipping fee must be a valid number.";
  }
  if (payload.shipping_fee < 0) {
    return "Shipping fee must be greater than or equal to 0.";
  }

  if (typeof payload.tax_rate !== "number" || !Number.isFinite(payload.tax_rate)) {
    return "Tax rate must be a valid number.";
  }
  if (payload.tax_rate < 0) {
    return "Tax rate must be greater than or equal to 0.";
  }

  const categoryIds = Array.isArray(payload.category_ids)
    ? payload.category_ids.filter(
        (item): item is number => typeof item === "number" && Number.isFinite(item)
      )
    : [];
  if (!categoryIds.length) {
    return "At least one category is required.";
  }

  const categoryBranch = Array.isArray(payload.category_branch)
    ? payload.category_branch.filter(
        (
          item
        ): item is {
          id: number;
          tier?: number | null;
          is_leaf?: boolean;
        } =>
          !!item &&
          typeof item.id === "number" &&
          Number.isFinite(item.id)
      )
    : [];
  if (!categoryBranch.length) {
    return "Category branch is required.";
  }

  const firstLeaf = categoryBranch.find((item) => item.is_leaf === true);
  if (!firstLeaf) {
    return "Category branch must include at least one leaf node.";
  }
  if (!categoryIds.includes(firstLeaf.id)) {
    return "The first leaf category must exist in selected category IDs.";
  }

  if (typeof payload.title !== "string" || !payload.title.trim().length) {
    return "Title is required.";
  }

  const currency = typeof payload.currency === "string" ? payload.currency.trim() : "";
  if (!/^[A-Z]{3}$/.test(currency)) {
    return "Currency must be a 3-letter uppercase code.";
  }

  const price = typeof payload.price === "string" ? payload.price.trim() : "";
  const parsedPrice = Number(price);
  if (!price.length || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    return "Price must be a positive numeric string.";
  }

  const mainImages = Array.isArray(payload.images)
    ? payload.images.filter((item): item is string => typeof item === "string")
    : [];
  const variationImages = Array.isArray(payload.variations)
    ? payload.variations.flatMap((variation) =>
        Array.isArray(variation?.images)
          ? variation.images.filter((item): item is string => typeof item === "string")
          : []
      )
    : [];
  const imageUrls = uniqueStringArray([...mainImages, ...variationImages]);
  const usableImageUrls = imageUrls.filter(isUsableImageUrl);
  if (!usableImageUrls.length) {
    return "At least one usable image URL is required.";
  }

  if (Array.isArray(payload.variations)) {
    const seenPositions = new Set<number>();
    for (const variation of payload.variations) {
      const position = toFiniteNumber(variation?.position);
      if (position == null) {
        return "Each variation must have a numeric position.";
      }
      if (seenPositions.has(position)) {
        return "Variation positions cannot be duplicated.";
      }
      seenPositions.add(position);
    }
  }

  if (!payload.main_image_ref || typeof payload.main_image_ref !== "object") {
    return "Main image reference is required.";
  }

  const mainContainer = payload.main_image_ref.container;
  if (mainContainer !== "main" && mainContainer !== "variation") {
    return "Main image container must be main or variation.";
  }

  const mainImageUrl =
    typeof payload.main_image_ref.url === "string"
      ? payload.main_image_ref.url.trim()
      : "";
  if (!mainImageUrl.length) {
    return "Main image URL is required.";
  }
  if (!imageUrls.includes(mainImageUrl)) {
    return "Main image URL must exist in images or variation images.";
  }

  if (
    mainContainer === "variation" &&
    toFiniteNumber(payload.main_image_ref.variation_position) == null
  ) {
    return "Main image variation position is required when container is variation.";
  }

  if (payload.status != null && payload.status !== "READY_FOR_REVIEW") {
    return "Status must be READY_FOR_REVIEW when provided.";
  }

  return null;
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
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const [publishVisibility, setPublishVisibility] = React.useState(true);
  const [activeDragType, setActiveDragType] = React.useState<DragKind>(null);
  const [variationImageUrlInputs, setVariationImageUrlInputs] = React.useState<
    Record<string, string>
  >({});
  const [selectedVariationImageIds, setSelectedVariationImageIds] = React.useState<
    Record<string, string>
  >({});
  const [imageResolutionById, setImageResolutionById] = React.useState<
    Record<string, string>
  >({});
  const [previewImage, setPreviewImage] = React.useState<{
    src: string;
    resolution: string;
    label: string;
  } | null>(null);
  const [aiEditPreview, setAiEditPreview] = React.useState<AiEditPreviewState | null>(null);
  const [aiImageModel, setAiImageModel] = React.useState<GeminiImageEditModel>(
    DEFAULT_GEMINI_IMAGE_EDIT_MODEL
  );
  const [categoryQuery, setCategoryQuery] = React.useState("");
  const [categoryCandidates, setCategoryCandidates] = React.useState<CategoryTaxonomyCandidate[]>(
    []
  );
  const [isCategorySearching, setIsCategorySearching] = React.useState(false);
  const [categorySearchError, setCategorySearchError] = React.useState<string | null>(null);
  const [selectedCategoryPreview, setSelectedCategoryPreview] =
    React.useState<SelectedCategoryPreview | null>(null);

  const [editState, setEditState] = React.useState<EditState | null>(null);
  const editSnapshotRef = React.useRef<EditSnapshot | null>(null);
  const editStateRef = React.useRef<EditState | null>(null);
  const aiEditPreviewRef = React.useRef<AiEditPreviewState | null>(null);
  const imageResolutionCacheRef = React.useRef<Map<string, string>>(new Map());
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const draftPayload = React.useMemo(() => draft?.draft ?? null, [draft]);
  const categoryQueryTrimmed = React.useMemo(() => categoryQuery.trim(), [categoryQuery]);
  const selectedAiImageModel = React.useMemo(
    () =>
      GEMINI_IMAGE_EDIT_MODELS.find((item) => item.value === aiImageModel) ??
      GEMINI_IMAGE_EDIT_MODELS[0],
    [aiImageModel]
  );

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
    setPublishVisibility(true);
  }, [draftId]);

  React.useEffect(() => {
    const storedValue = window.localStorage.getItem(AI_IMAGE_MODEL_STORAGE_KEY);
    if (!storedValue) return;
    const isSupported = GEMINI_IMAGE_EDIT_MODELS.some((item) => item.value === storedValue);
    if (isSupported) {
      setAiImageModel(storedValue as GeminiImageEditModel);
    }
  }, []);

  React.useEffect(() => {
    window.localStorage.setItem(AI_IMAGE_MODEL_STORAGE_KEY, aiImageModel);
  }, [aiImageModel]);

  React.useEffect(() => {
    if (!draftId) return;
    if (!draft) return;
    if (isTerminalStatus(draft.status)) return;

    const timer = window.setInterval(() => {
      void refresh();
    }, 2500);

    return () => window.clearInterval(timer);
  }, [draft, draftId, refresh]);

  React.useEffect(() => {
    if (!categoryQueryTrimmed.length) {
      setCategoryCandidates([]);
      setCategorySearchError(null);
      setIsCategorySearching(false);
      return;
    }

    let cancelled = false;
    setIsCategorySearching(true);
    setCategorySearchError(null);

    const timer = window.setTimeout(async () => {
      try {
        const result = await searchCategoryTaxonomy(categoryQueryTrimmed, {
          limit: 20,
          includeParents: true,
        });
        if (cancelled) return;
        setCategoryCandidates(Array.isArray(result.candidates) ? result.candidates : []);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Failed to search categories";
        setCategorySearchError(message);
        setCategoryCandidates([]);
      } finally {
        if (!cancelled) {
          setIsCategorySearching(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [categoryQueryTrimmed]);

  const updateEditState = React.useCallback(
    (updater: (prev: EditState) => EditState) => {
      setEditState((prev) => {
        if (!prev) return prev;
        const next = normalizeMainImageSelection(updater(prev));
        const snapshot = editSnapshotRef.current;
        return snapshot ? { ...next, isDirty: computeIsDirty(next, snapshot) } : next;
      });
    },
    []
  );

  const closeAiEditPreview = React.useCallback((revokeProcessedPreview: boolean) => {
    setAiEditPreview((prev) => {
      if (prev && revokeProcessedPreview) {
        URL.revokeObjectURL(prev.processedPreviewUrl);
      }
      return null;
    });
  }, []);

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
      closeAiEditPreview(true);
      setPreviewImage(null);
      setCategoryQuery("");
      setCategoryCandidates([]);
      setCategorySearchError(null);
      setIsCategorySearching(false);
      setSelectedCategoryPreview(null);
      setVariationImageUrlInputs({});
      setSelectedVariationImageIds({});
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
    closeAiEditPreview(true);
    setPreviewImage(null);
    setCategoryQuery("");
    setCategoryCandidates([]);
    setCategorySearchError(null);
    setIsCategorySearching(false);
    setSelectedCategoryPreview(null);
    setVariationImageUrlInputs({});
    setSelectedVariationImageIds({});
  }, [closeAiEditPreview, draftPayload]);

  React.useEffect(() => {
    editStateRef.current = editState;
  }, [editState]);

  React.useEffect(() => {
    aiEditPreviewRef.current = aiEditPreview;
  }, [aiEditPreview]);

  const imageResolutionTargets = React.useMemo(() => {
    if (!editState) return [] as Array<{ id: string; previewUrl: string }>;

    const mainImages = editState.images.map((image) => ({
      id: image.id,
      previewUrl: image.previewUrl,
    }));

    const variationImages = editState.variations.flatMap((variation) =>
      variation.images.map((image) => ({
        id: image.id,
        previewUrl: image.previewUrl,
      }))
    );

    return [...mainImages, ...variationImages];
  }, [editState]);

  const imageResolutionSignature = React.useMemo(
    () =>
      imageResolutionTargets
        .map((item) => `${item.id}:${item.previewUrl}`)
        .sort()
        .join("|"),
    [imageResolutionTargets]
  );

  React.useEffect(() => {
    if (!imageResolutionTargets.length) {
      setImageResolutionById({});
      return;
    }

    let cancelled = false;

    const loadResolutions = async () => {
      const entries = await Promise.all(
        imageResolutionTargets.map(async (item) => {
          const cached = imageResolutionCacheRef.current.get(item.previewUrl);
          if (cached) return [item.id, cached] as const;

          const resolution = await readImageResolution(item.previewUrl);
          imageResolutionCacheRef.current.set(item.previewUrl, resolution);
          return [item.id, resolution] as const;
        })
      );

      if (cancelled) return;
      setImageResolutionById(Object.fromEntries(entries));
    };

    void loadResolutions();

    return () => {
      cancelled = true;
    };
  }, [imageResolutionSignature, imageResolutionTargets]);

  React.useEffect(() => {
    return () => {
      revokeNewImagePreviews(editStateRef.current);
      revokeNewVariationPreviews(editStateRef.current);
      if (aiEditPreviewRef.current) {
        URL.revokeObjectURL(aiEditPreviewRef.current.processedPreviewUrl);
      }
    };
  }, []);

  const hasCategoryIds = (editState?.categoryIds.length ?? 0) > 0;
  const publishBlockedByCategory = !hasCategoryIds;

  const onPublish = async () => {
    if (!draftId) return;
    if (!editState) {
      open?.({
        type: "error",
        message: "Draft payload missing",
        description: "Draft payload is required before publishing.",
      });
      return;
    }
    if (publishBlockedByCategory) {
      open?.({
        type: "error",
        message: "Category required",
        description: "Select a category before publishing.",
      });
      return;
    }
    setIsPublishing(true);
    try {
      const finalPayload = await toPayload(editState, "READY_FOR_REVIEW", draft?.draft?.url);
      const publishPayload = {
        ...finalPayload,
        draft_id: draftId,
        visibility: publishVisibility,
      };
      const validationError = validatePublishPayload(draftId, publishPayload);
      if (validationError) {
        open?.({
          type: "error",
          message: "Publish validation failed",
          description: validationError,
        });
        return;
      }
      const result = await publishProductDraft(draftId, publishPayload);
      const publishedVisibility =
        typeof result.visibility === "boolean" ? result.visibility : publishVisibility;
      open?.({
        type: "success",
        message: "Published",
        description: `Product ID: ${result.product_id} · ${publishedVisibility ? "已上架" : "未上架"}`,
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

  const onDelete = async () => {
    if (!draftId) return;
    setIsDeleting(true);
    try {
      await deleteProductDraft(draftId);
      open?.({
        type: "success",
        message: "Draft deleted",
        description: `${draftId} was deleted.`,
      });
      setIsDeleteDialogOpen(false);
      navigate("/products/drafts", { replace: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      open?.({ type: "error", message: "Delete failed", description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  const onSelectCategoryCandidate = (candidate: CategoryTaxonomyCandidate) => {
    const branch: CategoryBranchItem[] = candidate.branch
      .map((node, index, all) => ({
        id: node.id,
        tier: Number.isFinite(node.tier) ? node.tier : null,
        isLeaf: index === all.length - 1,
      }))
      .filter((node) => Number.isFinite(node.id));
    const branchIds = uniqueNumberArray(branch.map((node) => node.id));
    const branchPath = candidate.branch
      .map((node) => node.label.trim())
      .filter((label) => label.length > 0)
      .join(" > ");

    updateEditState((prev) => ({
      ...prev,
      categoryIds: branchIds,
      categoryBranch: branch,
    }));
    setSelectedCategoryPreview({
      leafLabel: candidate.leaf_label,
      branchPath,
    });
    setCategoryQuery("");
    setCategoryCandidates([]);
    setCategorySearchError(null);
  };

  const onClearCategorySelection = () => {
    updateEditState((prev) => ({
      ...prev,
      categoryIds: [],
      categoryBranch: [],
    }));
    setSelectedCategoryPreview(null);
    setCategoryQuery("");
    setCategoryCandidates([]);
    setCategorySearchError(null);
  };

  const onAiEditImage = React.useCallback(
    async (containerId: ImageContainerId, image: EditImageItem, mode: ImageAiEditMode) => {
      const prompt =
        mode === "remove_chinese_text" ? PROMPT_REMOVE_CHINESE_TEXT : PROMPT_REMOVE_BACKGROUND;
      const actionLabel = imageAiEditModeLabel(mode);

      try {
        const processedBlob = await aiEditImage(image.previewUrl, prompt, {
          model: aiImageModel,
        });
        if (!processedBlob.type.startsWith("image/")) {
          throw new Error("Gemini did not return a valid image.");
        }
        const extension =
          processedBlob.type === "image/png"
            ? "png"
            : processedBlob.type === "image/webp"
              ? "webp"
              : "jpg";
        const file = new File(
          [processedBlob],
          `ai-edit-${mode}-${Date.now()}.${extension}`,
          { type: processedBlob.type }
        );
        const processedPreviewUrl = URL.createObjectURL(file);

        setPreviewImage(null);
        setAiEditPreview((prev) => {
          if (prev) {
            URL.revokeObjectURL(prev.processedPreviewUrl);
          }
          return {
            containerId,
            imageId: image.id,
            mode,
            originalUrl: image.previewUrl,
            processedPreviewUrl,
            processedFile: file,
          };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        open?.({
          type: "error",
          message: `${actionLabel} failed`,
          description: message,
        });
      }
    },
    [aiImageModel, open]
  );

  const onAcceptAiEditPreview = React.useCallback(() => {
    const current = aiEditPreviewRef.current;
    if (!current) return;

    const state = editStateRef.current;
    if (!state || !isImageInContainer(state, current.containerId, current.imageId)) {
      closeAiEditPreview(true);
      open?.({
        type: "error",
        message: "Apply AI edit failed",
        description: "Target image is no longer available.",
      });
      return;
    }

    updateEditState((prev) =>
      replaceImageWithUploaded(
        prev,
        current.containerId,
        current.imageId,
        current.processedFile,
        current.processedPreviewUrl
      )
    );
    closeAiEditPreview(false);
    open?.({
      type: "success",
      message: `${imageAiEditModeLabel(current.mode)} applied`,
      description: "Image replaced in draft.",
    });
  }, [closeAiEditPreview, open, updateEditState]);

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
      <ListViewHeader title="Product Drafts" canCreate={false} />
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
              disabled={isDeleting}
            >
              New draft
            </Button>
            <Button variant="outline" onClick={() => void refresh()} disabled={isDeleting}>
              Refresh
            </Button>
            <Button
              variant="destructive"
              onClick={() => setIsDeleteDialogOpen(true)}
              disabled={isDeleting || isLoading || !draft}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete Draft
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
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div className="text-sm font-medium">Review</div>
                    <div className="flex flex-col items-start gap-1 lg:items-end">
                      <div className="flex items-center gap-2">
                        <div className="mr-2 flex items-start gap-2 rounded-md border px-2 py-1.5">
                          <Checkbox
                            id="publish-visibility"
                            checked={publishVisibility}
                            onCheckedChange={(checked) =>
                              setPublishVisibility(
                                checked === "indeterminate" ? true : checked
                              )
                            }
                            disabled={isPublishing || isRejecting || isSaving || isDeleting}
                          />
                          <div className="flex flex-col">
                            <Label htmlFor="publish-visibility" className="leading-none">
                              上架
                            </Label>
                            <span className="text-[11px] text-muted-foreground">
                              勾選後發佈即對客可見，可立即下單
                            </span>
                          </div>
                        </div>
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
                          disabled={!editState || !editState.isDirty || isDeleting}
                        >
                          Reset
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void onSave()}
                          disabled={!editState || !editState.isDirty || isSaving || isDeleting}
                        >
                          {isSaving ? "Saving..." : "Save changes"}
                        </Button>
                        <Button
                          onClick={() => void onPublish()}
                          disabled={
                            isPublishing ||
                            isRejecting ||
                            isSaving ||
                            isDeleting ||
                            publishBlockedByCategory
                          }
                        >
                          {isPublishing ? "Publishing..." : "Publish"}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void onReject()}
                          disabled={isPublishing || isRejecting || isDeleting}
                        >
                          {isRejecting ? "Rejecting..." : "Reject"}
                        </Button>
                      </div>
                      {publishBlockedByCategory ? (
                        <div className="text-xs text-destructive">
                          Category is required before publish.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {editState ? (
                    <DndContext
                      sensors={dndSensors}
                      collisionDetection={(args) => {
                        const dragType = args.active.data.current?.dragType;

                        if (dragType === "image_item") {
                          const imageContainers = args.droppableContainers.filter(
                            (container) =>
                              container.data.current?.dropType === "image_container"
                          );
                          const byPointer = pointerWithin({
                            ...args,
                            droppableContainers: imageContainers,
                          });
                          if (byPointer.length) return byPointer;
                          return closestCenter({
                            ...args,
                            droppableContainers: imageContainers,
                          });
                        }

                        if (dragType === "variation_row") {
                          const sortableContainers = args.droppableContainers.filter(
                            (container) =>
                              container.data.current?.dropType !== "image_container"
                          );
                          return closestCenter({
                            ...args,
                            droppableContainers: sortableContainers,
                          });
                        }

                        return closestCenter(args);
                      }}
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

                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

                                <div className="flex flex-col gap-2">
                                  <Label htmlFor="draft-tax-rate">Tax Rate (0~1)</Label>
                                  <Input
                                    id="draft-tax-rate"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="1"
                                    inputMode="decimal"
                                    value={editState.taxRate}
                                    onChange={(e) =>
                                      updateEditState((prev) => ({
                                        ...prev,
                                        taxRate: e.target.value,
                                      }))
                                    }
                                    placeholder="0"
                                  />
                                </div>

                                <div className="flex flex-col gap-2">
                                  <Label htmlFor="draft-shipping-fee">Shipping Fee</Label>
                                  <Input
                                    id="draft-shipping-fee"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    inputMode="decimal"
                                    value={editState.shippingFee}
                                    onChange={(e) =>
                                      updateEditState((prev) => ({
                                        ...prev,
                                        shippingFee: e.target.value,
                                      }))
                                    }
                                    placeholder="0"
                                  />
                                </div>
                              </div>

                              <div className="flex flex-col gap-2">
                                <Label htmlFor="draft-category-search">Category</Label>
                                <Input
                                  id="draft-category-search"
                                  value={categoryQuery}
                                  onChange={(event) => setCategoryQuery(event.target.value)}
                                  placeholder="Search categories (e.g. Mice)"
                                  autoComplete="off"
                                  className={cn(
                                    isCategorySearching
                                      ? "border-primary/60 ring-2 ring-primary/20"
                                      : ""
                                  )}
                                />
                                <div className="text-xs text-muted-foreground">
                                  Search and select one category candidate. Saving stores
                                  <code> category_ids</code> and <code> category_branch</code>.
                                </div>
                                {isCategorySearching ? (
                                  <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span>Searching categories...</span>
                                  </div>
                                ) : null}
                                {categorySearchError ? (
                                  <div className="text-xs text-destructive">
                                    {categorySearchError}
                                  </div>
                                ) : null}
                                {!isCategorySearching &&
                                !categorySearchError &&
                                categoryQueryTrimmed.length > 0 &&
                                categoryCandidates.length === 0 ? (
                                  <div className="text-xs text-muted-foreground">
                                    No categories found.
                                  </div>
                                ) : null}
                                {!isCategorySearching && categoryCandidates.length > 0 ? (
                                  <div className="max-h-64 overflow-auto rounded-md border">
                                    {categoryCandidates.map((candidate) => {
                                      const branchPath = candidate.branch
                                        .map((node) => node.label.trim())
                                        .filter((label) => label.length > 0)
                                        .join(" > ");
                                      const matchedPath = candidate.matched_path
                                        .map((item) => item.trim())
                                        .filter((item) => item.length > 0)
                                        .join(" > ");
                                      return (
                                        <button
                                          key={`${candidate.leaf_id}-${candidate.leaf_name}`}
                                          type="button"
                                          className={cn(
                                            "w-full border-b px-3 py-2 text-left text-sm last:border-b-0",
                                            "hover:bg-muted/60"
                                          )}
                                          onClick={() => onSelectCategoryCandidate(candidate)}
                                        >
                                          <div className="font-medium">{candidate.leaf_label}</div>
                                          <div className="text-xs text-muted-foreground">
                                            {branchPath || "No branch path"}
                                          </div>
                                          {matchedPath.length ? (
                                            <div className="text-[11px] text-muted-foreground/90">
                                              Match: {matchedPath}
                                            </div>
                                          ) : null}
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : null}

                                <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                                  {editState.categoryIds.length ? (
                                    <div className="flex flex-col gap-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="font-medium">
                                          {selectedCategoryPreview?.leafLabel ?? "Selected category"}
                                        </div>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 px-2 text-xs"
                                          onClick={onClearCategorySelection}
                                        >
                                          Clear
                                        </Button>
                                      </div>
                                      {selectedCategoryPreview?.branchPath ? (
                                        <div className="text-muted-foreground">
                                          {selectedCategoryPreview.branchPath}
                                        </div>
                                      ) : null}
                                      <div className="text-muted-foreground">
                                        Category IDs: {editState.categoryIds.join(", ")}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-destructive">
                                      No category selected. Category is required before publish.
                                    </div>
                                  )}
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
                                      {editState.variations.map((variation) => {
                                        const selectedVariationImage = getSelectedVariationImage(
                                          variation,
                                          selectedVariationImageIds[variation.id]
                                        );
                                        return (
                                          <SortableVariationRow key={variation.id} id={variation.id}>
                                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                                            <div className="sm:col-span-7">
                                              <DroppableImageContainer
                                                containerId={toVariationContainerId(variation.id)}
                                                isEnabled={activeDragType === "image_item"}
                                                className="rounded-md p-1"
                                              >
                                                <div className="mb-2 flex items-center justify-between gap-2">
                                                  <div className="text-xs text-muted-foreground">
                                                    Click image to select, then use actions below
                                                  </div>
                                                  <div className="text-xs text-muted-foreground">
                                                    {variation.images.length} image(s)
                                                  </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                                                  {variation.images.map((image) => (
                                                    <DraggableImageCard
                                                      key={image.id}
                                                      containerId={toVariationContainerId(variation.id)}
                                                      image={image}
                                                      alt="Variation"
                                                      imageClassName="h-32 w-full object-cover"
                                                      badgeLabel={
                                                        image.type === "existing" ? "URL" : "Uploaded"
                                                      }
                                                      resolutionText={
                                                        imageResolutionById[image.id] ?? "—"
                                                      }
                                                      isSelected={selectedVariationImage?.id === image.id}
                                                      isMain={isMainImageSelection(
                                                        editState.mainImageSelection,
                                                        toVariationContainerId(variation.id),
                                                        image.id
                                                      )}
                                                      showInlineSetMain={false}
                                                      showInlineRemove={false}
                                                      onPreview={(nextImage) =>
                                                        {
                                                          setSelectedVariationImageIds((prev) => ({
                                                            ...prev,
                                                            [variation.id]: nextImage.id,
                                                          }));
                                                          setPreviewImage({
                                                            src: nextImage.previewUrl,
                                                            resolution:
                                                              imageResolutionById[nextImage.id] ?? "—",
                                                            label: "Variation image",
                                                          });
                                                        }
                                                      }
                                                      onAiEdit={onAiEditImage}
                                                    />
                                                  ))}
                                                  <button
                                                    type="button"
                                                    className={cn(
                                                      "flex h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-[11px] text-muted-foreground transition-colors",
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

                                            <div className="sm:col-span-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                              <div className="flex flex-col gap-1 sm:col-span-2">
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

                                              <div className="flex flex-col gap-1">
                                                <Label className="text-xs">Price</Label>
                                                <Input
                                                  value={variation.price}
                                                  type="text"
                                                  inputMode="decimal"
                                                  placeholder="Variation price"
                                                  onChange={(e) =>
                                                    updateEditState((prev) =>
                                                      updateVariationField(
                                                        prev,
                                                        variation.id,
                                                        (item) => ({
                                                          ...item,
                                                          price: e.target.value,
                                                        })
                                                      )
                                                    )
                                                  }
                                                />
                                              </div>

                                              <div className="flex flex-col gap-1">
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
                                          </div>

                                          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2 py-2">
                                            <div className="text-xs text-muted-foreground">
                                              Selected:
                                              {" "}
                                              {selectedVariationImage
                                                ? selectedVariationImage.type === "existing"
                                                  ? "URL image"
                                                  : "Uploaded image"
                                                : "None"}
                                            </div>
                                            <Button
                                              type="button"
                                              variant="secondary"
                                              size="sm"
                                              disabled={
                                                !selectedVariationImage ||
                                                isMainImageSelection(
                                                  editState.mainImageSelection,
                                                  toVariationContainerId(variation.id),
                                                  selectedVariationImage.id
                                                )
                                              }
                                              onClick={() => {
                                                if (!selectedVariationImage) return;
                                                updateEditState((prev) => ({
                                                  ...prev,
                                                  mainImageSelection: {
                                                    containerId: toVariationContainerId(variation.id),
                                                    imageId: selectedVariationImage.id,
                                                  },
                                                }));
                                              }}
                                            >
                                              {selectedVariationImage &&
                                              isMainImageSelection(
                                                editState.mainImageSelection,
                                                toVariationContainerId(variation.id),
                                                selectedVariationImage.id
                                              )
                                                ? "Selected is main"
                                                : "Set selected as main"}
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              disabled={!selectedVariationImage}
                                              onClick={() => {
                                                if (!selectedVariationImage) return;
                                                setPreviewImage({
                                                  src: selectedVariationImage.previewUrl,
                                                  resolution:
                                                    imageResolutionById[selectedVariationImage.id] ??
                                                    "—",
                                                  label: "Variation image",
                                                });
                                              }}
                                            >
                                              Preview selected
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="destructive"
                                              size="sm"
                                              disabled={!selectedVariationImage}
                                              onClick={() => {
                                                if (!selectedVariationImage) return;
                                                updateEditState((prev) =>
                                                  removeVariationImage(
                                                    prev,
                                                    variation.id,
                                                    selectedVariationImage.id
                                                  )
                                                );
                                              }}
                                            >
                                              Remove selected
                                            </Button>
                                            {selectedVariationImage?.type === "existing" ? (
                                              <Input
                                                value={selectedVariationImage.url ?? ""}
                                                placeholder="Selected image URL"
                                                className="h-8 min-w-[16rem] flex-1"
                                                onChange={(e) =>
                                                  updateEditState((prev) =>
                                                    updateVariationImageUrl(
                                                      prev,
                                                      variation.id,
                                                      selectedVariationImage.id,
                                                      e.target.value
                                                    )
                                                  )
                                                }
                                              />
                                            ) : null}
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
                                        );
                                      })}
                                    </SortableContext>
                                  </div>
                                )}
                              </div>

                            </div>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader className="gap-3">
                            <CardTitle className="text-base">Images</CardTitle>
                            <div className="grid gap-2 sm:max-w-md">
                              <Label htmlFor="ai-image-model">AI Image Edit Model</Label>
                              <Select
                                value={aiImageModel}
                                onValueChange={(value) => {
                                  const isSupported = GEMINI_IMAGE_EDIT_MODELS.some(
                                    (item) => item.value === value
                                  );
                                  if (!isSupported) return;
                                  setAiImageModel(value as GeminiImageEditModel);
                                }}
                              >
                                <SelectTrigger id="ai-image-model">
                                  <SelectValue placeholder="Select model" />
                                </SelectTrigger>
                                <SelectContent>
                                  {GEMINI_IMAGE_EDIT_MODELS.map((item) => (
                                    <SelectItem key={item.value} value={item.value}>
                                      {item.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-muted-foreground">
                                Used for “Remove Chinese Text” and “Remove Background”.
                                {" "}
                                2.5 Flash is usually cheaper; 3.1 Flash is usually more stable.
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Current:
                                {" "}
                                {selectedAiImageModel.label}
                                {" · "}
                                {selectedAiImageModel.hint}
                              </p>
                            </div>
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
                                    resolutionText={imageResolutionById[image.id] ?? "—"}
                                    isMain={isMainImageSelection(
                                      editState.mainImageSelection,
                                      "main",
                                      image.id
                                    )}
                                    onRemove={() =>
                                      updateEditState((prev) => removeImage(prev, image))
                                    }
                                    onSetMain={(nextImage) =>
                                      updateEditState((prev) => ({
                                        ...prev,
                                        mainImageSelection: {
                                          containerId: "main",
                                          imageId: nextImage.id,
                                        },
                                      }))
                                    }
                                    onPreview={(nextImage) =>
                                      setPreviewImage({
                                        src: nextImage.previewUrl,
                                        resolution: imageResolutionById[nextImage.id] ?? "—",
                                        label: "Draft image",
                                      })
                                    }
                                    onAiEdit={onAiEditImage}
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

                  <Dialog
                    open={!!previewImage}
                    onOpenChange={(open) => {
                      if (!open) setPreviewImage(null);
                    }}
                  >
                    <DialogContent className="max-w-[min(96vw,1200px)] border-none bg-transparent p-0 shadow-none">
                      <DialogTitle className="sr-only">
                        {previewImage?.label ?? "Image preview"}
                      </DialogTitle>
                      {previewImage ? (
                        <div className="overflow-hidden rounded-lg border bg-black">
                          <div className="flex items-center justify-between border-b border-white/20 px-4 py-2 text-xs text-white/80">
                            <span>{previewImage.label}</span>
                            <span>{previewImage.resolution}</span>
                          </div>
                          <div className="flex h-[min(82vh,920px)] items-center justify-center p-3">
                            <img
                              src={previewImage.src}
                              alt={previewImage.label}
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                        </div>
                      ) : null}
                    </DialogContent>
                  </Dialog>

                  <Dialog
                    open={!!aiEditPreview}
                    onOpenChange={(open) => {
                      if (!open) closeAiEditPreview(true);
                    }}
                  >
                    <DialogContent className="max-w-[min(96vw,1320px)]">
                      <DialogTitle>
                        Review AI Edit: {aiEditPreview ? imageAiEditModeLabel(aiEditPreview.mode) : ""}
                      </DialogTitle>
                      {aiEditPreview ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <div className="overflow-hidden rounded-md border bg-muted/20">
                              <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                                Original
                              </div>
                              <div className="flex h-[min(68vh,720px)] items-center justify-center p-3">
                                <img
                                  src={aiEditPreview.originalUrl}
                                  alt="Original image"
                                  className="max-h-full max-w-full object-contain"
                                />
                              </div>
                            </div>
                            <div className="overflow-hidden rounded-md border bg-muted/20">
                              <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                                Processed
                              </div>
                              <div className="flex h-[min(68vh,720px)] items-center justify-center p-3">
                                <img
                                  src={aiEditPreview.processedPreviewUrl}
                                  alt="Processed image"
                                  className="max-h-full max-w-full object-contain"
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => closeAiEditPreview(true)}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              onClick={onAcceptAiEditPreview}
                            >
                              Accept
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (isDeleting) return;
          setIsDeleteDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Draft <span className="font-mono">{draftId}</span> will be permanently deleted. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void onDelete();
              }}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ListView>
  );
}
