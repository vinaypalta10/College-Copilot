/**
 * Minimal Google OAuth 2.0 (Authorization Code flow) — no SDK, just fetch.
 *
 * Configure GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / OAUTH_REDIRECT_URL in .env.
 * When unconfigured, isConfigured() returns false and the app falls back to
 * dev-login (see src/api/auth.ts).
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export interface GoogleUser {
  sub: string;
  email: string;
  name: string | null;
}

export function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.OAUTH_REDIRECT_URL);
}

export function authUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.OAUTH_REDIRECT_URL!,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  // Optional @berkeley.edu restriction hint.
  if (process.env.OAUTH_HOSTED_DOMAIN) params.set("hd", process.env.OAUTH_HOSTED_DOMAIN);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<GoogleUser> {
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.OAUTH_REDIRECT_URL!,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const { access_token } = await tokenRes.json() as { access_token: string };

  const infoRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!infoRes.ok) {
    throw new Error(`userinfo failed: ${infoRes.status}`);
  }
  const info = await infoRes.json() as { sub: string; email: string; name?: string };
  return { sub: info.sub, email: info.email, name: info.name ?? null };
}
