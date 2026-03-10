function normalizeBaseUrl(input: string | undefined): string {
  const base = (input ?? "").trim();
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

/**
 * `VITE_API_BASE_URL` examples:
 * - "" (default): same-origin requests, e.g. `/api/...`
 * - "http://localhost:8080": requests become `http://localhost:8080/api/...`
 */
export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
export const PUBLISH_API_BASE_URL_PRODUCTION = normalizeBaseUrl(
  import.meta.env.VITE_PUBLISH_API_BASE_URL_PRODUCTION
);
export const PUBLISH_API_BASE_URL_STAGING = normalizeBaseUrl(
  import.meta.env.VITE_PUBLISH_API_BASE_URL_STAGING
);

export function withApiBaseUrl(pathOrUrl: string): string {
  if (!API_BASE_URL) return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (!pathOrUrl.startsWith("/")) return `${API_BASE_URL}/${pathOrUrl}`;
  return `${API_BASE_URL}${pathOrUrl}`;
}

export function getPublishApiBaseUrl(target: "staging" | "production"): string {
  const baseUrl =
    target === "production"
      ? PUBLISH_API_BASE_URL_PRODUCTION
      : PUBLISH_API_BASE_URL_STAGING;

  if (!baseUrl) {
    const envVarName =
      target === "production"
        ? "VITE_PUBLISH_API_BASE_URL_PRODUCTION"
        : "VITE_PUBLISH_API_BASE_URL_STAGING";
    throw new Error(`Missing ${envVarName} environment variable.`);
  }

  return baseUrl;
}

export function withPublishApiBaseUrl(
  pathOrUrl: string,
  target: "staging" | "production"
): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const baseUrl = getPublishApiBaseUrl(target);
  if (!pathOrUrl.startsWith("/")) return `${baseUrl}/${pathOrUrl}`;
  return `${baseUrl}${pathOrUrl}`;
}
