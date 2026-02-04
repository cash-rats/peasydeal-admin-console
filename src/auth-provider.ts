import type { AuthProvider } from "@refinedev/core";

import { apiFetch } from "@/lib/api-client";
import { withApiBaseUrl } from "@/lib/api-base-url";

type MeResponse = {
  id?: string;
  user_id?: string;
  email?: string;
  name?: string;
  full_name?: string;
  avatarUrl?: string;
  avatar_url?: string;
  imageUrl?: string;
  image_url?: string;
  roles?: string[];
};

const ME_ENDPOINT = withApiBaseUrl("/api/me");

function toIdentity(payload: MeResponse) {
  const fullName =
    payload.name ??
    payload.full_name ??
    payload.email ??
    payload.user_id ??
    payload.id ??
    "User";

  return {
    id: payload.id ?? payload.user_id ?? payload.email ?? "me",
    fullName,
    email: payload.email ?? "",
    avatar:
      payload.avatarUrl ??
      payload.avatar_url ??
      payload.imageUrl ??
      payload.image_url ??
      undefined,
  };
}

export function createAuthProvider(params: {
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}): AuthProvider {
  const { getToken, signOut } = params;

  return {
    login: async () => ({
      success: true,
      redirectTo: "/login",
    }),
    logout: async () => {
      await signOut();
      return {
        success: true,
        redirectTo: "/login",
      };
    },
    check: async () => {
      const token = await getToken();
      if (!token) {
        return {
          authenticated: false,
          redirectTo: "/login",
        };
      }

      const response = await apiFetch(ME_ENDPOINT);
      if (response.ok) {
        return {
          authenticated: true,
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          authenticated: false,
          logout: true,
          redirectTo: "/login",
        };
      }

      return {
        authenticated: false,
        redirectTo: "/login",
      };
    },
    getIdentity: async () => {
      const token = await getToken();
      if (!token) return null;

      const response = await apiFetch(ME_ENDPOINT);
      if (!response.ok) return null;

      const payload = (await response.json()) as MeResponse;
      return toIdentity(payload);
    },
    getPermissions: async () => {
      const token = await getToken();
      if (!token) return null;

      const response = await apiFetch(ME_ENDPOINT);
      if (!response.ok) return null;

      const payload = (await response.json()) as MeResponse;
      return payload.roles ?? null;
    },
  };
}
