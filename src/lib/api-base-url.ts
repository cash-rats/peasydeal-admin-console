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

export function withApiBaseUrl(pathOrUrl: string): string {
  if (!API_BASE_URL) return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (!pathOrUrl.startsWith("/")) return `${API_BASE_URL}/${pathOrUrl}`;
  return `${API_BASE_URL}${pathOrUrl}`;
}

