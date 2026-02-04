import { getAuthToken } from "@/lib/auth-token";

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);

  try {
    const token = await getAuthToken();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  } catch {
    // Ignore token retrieval errors to allow public endpoints.
  }

  return fetch(input, { ...init, headers });
}
