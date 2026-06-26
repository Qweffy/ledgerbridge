import type { QboConfig } from "../config";

// Tokens as we store them (camelCase), normalized from Intuit's snake_case response.
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until the access token expires (~3600)
  refreshTokenExpiresIn: number; // seconds until the refresh token expires (~100 days)
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
}

export function buildAuthorizeUrl(cfg: QboConfig, state: string): string {
  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scope);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function postToken(
  cfg: QboConfig,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<OAuthTokens> {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetchImpl(cfg.tokenUrl, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Intuit token endpoint ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as TokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    refreshTokenExpiresIn: json.x_refresh_token_expires_in,
  };
}

export function exchangeCode(
  cfg: QboConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
  });
  return postToken(cfg, body, fetchImpl);
}

export function refreshTokens(
  cfg: QboConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return postToken(cfg, body, fetchImpl);
}
