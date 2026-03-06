export const PROMPT_REMOVE_TEXT_OVERLAY = `
Remove all added text overlays, promotional labels, badges, callouts, and graphic annotations
from this product image, regardless of language or character set.
This includes mixed-language overlays such as Chinese plus English letters, numbers, symbols,
or any other non-product text added on top of the image.
Keep the product itself completely intact. Do not remove text that is physically part of the
product, packaging, or printed artwork captured in the original scene.
Reconstruct the background behind the removed overlays naturally so it blends seamlessly.
Do not add any new text or elements.
`.trim();

export const PROMPT_REMOVE_BACKGROUND = `
Remove the background from this product image. Keep only the product
with a clean pure white (#FFFFFF) background. Maintain the original
product size and proportions.
`.trim();

export const PROMPT_REPLACE_TEXT_OVERLAY_WITH_ENGLISH = `
Identify every added promotional text overlay, badge, label, callout, and annotation in this image.

For each added overlay:
1. Remove the original non-English or mixed-language text completely.
2. Replace it with natural, short, fluent English text.
3. Keep the replacement in approximately the same location and with similar visual prominence.

Important rules:
- Do not leave any original overlay text visible.
- Do not simply erase the overlays; replace them with English.
- Do not change the product, hand, photo, printed card, packaging, or background scene.
- Do not modify text that is physically part of the product or printed materials in the photographed scene.
- The final image should contain only English promotional overlay text, not Chinese or mixed-language overlay text.
- Keep the rewritten overlays clean, readable, and commercially natural.
`.trim();

export type GeminiImageEditModel =
  | "gemini-3.1-flash-image-preview"
  | "gemini-2.5-flash-image";

export const GEMINI_IMAGE_EDIT_MODELS: Array<{
  value: GeminiImageEditModel;
  label: string;
  hint: string;
}> = [
  {
    value: "gemini-3.1-flash-image-preview",
    label: "Gemini 3.1 Flash Image",
    hint: "Higher quality baseline (higher cost).",
  },
  {
    value: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image",
    hint: "Lower cost option for routine edits.",
  },
];

export const DEFAULT_GEMINI_IMAGE_EDIT_MODEL: GeminiImageEditModel =
  "gemini-3.1-flash-image-preview";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY?.trim();
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

type GeminiInlineData = {
  data?: string;
  mimeType?: string;
  mime_type?: string;
};

type GeminiPart = {
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
  text?: string;
};

type GeminiCandidate = {
  content?: {
    parts?: GeminiPart[];
  };
};

type GeminiApiResponse = {
  candidates?: GeminiCandidate[];
};

type AiEditImageOptions = {
  model?: GeminiImageEditModel;
};

function isGeminiImageEditModel(value: string): value is GeminiImageEditModel {
  return GEMINI_IMAGE_EDIT_MODELS.some((item) => item.value === value);
}

/**
 * Converts a Blob to a base64 string
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64Index = dataUrl.indexOf(",");
      if (base64Index < 0) {
        reject(new Error("Failed to encode image to base64."));
        return;
      }

      resolve(dataUrl.slice(base64Index + 1));
    };
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(blob);
  });
}

function extractInlineData(part: GeminiPart): GeminiInlineData | undefined {
  return part.inlineData ?? part.inline_data;
}

function decodeBase64ToBlob(base64Data: string, mimeType: string): Blob {
  let binaryString: string;
  try {
    binaryString = atob(base64Data.replace(/\s/g, ""));
  } catch {
    throw new Error("Gemini returned invalid image payload.");
  }

  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

async function parseGeminiError(response: Response): Promise<string> {
  const fallback = `Gemini API error (HTTP ${response.status})`;
  const raw = await response.text();
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; code?: number; status?: string };
    };
    const message = parsed.error?.message;
    if (message) return `${fallback}: ${message}`;
  } catch {
    // Ignore parse error and return plain response body.
  }

  return `${fallback}: ${raw}`;
}

/**
 * Calls Gemini REST API to edit an image based on the provided prompt
 */
export async function aiEditImage(
  imageUrl: string,
  prompt: string,
  options?: AiEditImageOptions
): Promise<Blob> {
  if (!GEMINI_API_KEY) {
    throw new Error("VITE_GEMINI_API_KEY is not set in environment variables.");
  }
  if (!imageUrl.trim()) {
    throw new Error("Image URL is required.");
  }
  if (!prompt.trim()) {
    throw new Error("Prompt is required for AI image editing.");
  }
  const selectedModel = options?.model ?? DEFAULT_GEMINI_IMAGE_EDIT_MODEL;
  if (!isGeminiImageEditModel(selectedModel)) {
    throw new Error(`Unsupported Gemini image model: ${selectedModel}`);
  }

  // 1. Fetch the image and convert to base64
  let imgResponse: Response;
  try {
    imgResponse = await fetch(imageUrl);
  } catch (error) {
    throw new Error(
      `Failed to fetch original image: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!imgResponse.ok) {
    throw new Error(`Failed to fetch original image: HTTP ${imgResponse.status}`);
  }

  const imgBlob = await imgResponse.blob();
  if (!imgBlob.type.startsWith("image/")) {
    throw new Error(`Fetched URL is not an image (got ${imgBlob.type})`);
  }

  const base64 = await blobToBase64(imgBlob);

  // 2. Call Gemini API
  let response: Response;
  try {
    response = await fetch(
      `${GEMINI_ENDPOINT}/models/${selectedModel}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: imgBlob.type, data: base64 } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
          },
        }),
      }
    );
  } catch (error) {
    throw new Error(
      `Failed to call Gemini API: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!response.ok) {
    throw new Error(await parseGeminiError(response));
  }

  let result: GeminiApiResponse;
  try {
    result = (await response.json()) as GeminiApiResponse;
  } catch {
    throw new Error("Failed to parse Gemini API response.");
  }

  const parts = result.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
  if (parts.length === 0) {
    throw new Error("Unexpected response structure from Gemini API");
  }

  // 3. Extract processed image from response.
  const imagePart = parts.find((part) => {
    const inlineData = extractInlineData(part);
    return typeof inlineData?.data === "string" && inlineData.data.length > 0;
  });

  if (!imagePart) {
    const responseText = parts
      .map((part) => part.text?.trim())
      .filter((text): text is string => Boolean(text))
      .join(" ");

    const reason = responseText
      ? ` Gemini text response: ${responseText}`
      : " The model might have refused the request or returned only text.";
    throw new Error(`Gemini API did not return an image.${reason}`);
  }

  const inlineData = extractInlineData(imagePart);
  if (!inlineData?.data) {
    throw new Error("Gemini API returned an image part without data.");
  }
  const mimeType = inlineData.mimeType ?? inlineData.mime_type ?? "image/png";
  const base64Data = inlineData.data;

  return decodeBase64ToBlob(base64Data, mimeType);
}
