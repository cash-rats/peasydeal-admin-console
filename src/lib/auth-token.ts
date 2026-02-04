export type AuthTokenProvider = () => Promise<string | null>;

let authTokenProvider: AuthTokenProvider | null = null;

export function setAuthTokenProvider(provider: AuthTokenProvider | null) {
  authTokenProvider = provider;
}

export async function getAuthToken(): Promise<string | null> {
  if (!authTokenProvider) return null;
  return authTokenProvider();
}
