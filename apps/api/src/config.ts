import { z } from "zod";

// QBO/Intuit configuration, validated from the environment. The OAuth endpoints
// are the same for sandbox and production; only the Accounting API base differs.
const envSchema = z.object({
  QBO_CLIENT_ID: z.string().min(1),
  QBO_CLIENT_SECRET: z.string().min(1),
  QBO_REDIRECT_URI: z.string().url(),
  QBO_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
});

export interface QboConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: "sandbox" | "production";
  scope: string;
  minorVersion: string;
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  apiBaseUrl: string;
}

export function loadQboConfig(env: NodeJS.ProcessEnv = process.env): QboConfig {
  const parsed = envSchema.parse(env);
  const isSandbox = parsed.QBO_ENVIRONMENT === "sandbox";
  return {
    clientId: parsed.QBO_CLIENT_ID,
    clientSecret: parsed.QBO_CLIENT_SECRET,
    redirectUri: parsed.QBO_REDIRECT_URI,
    environment: parsed.QBO_ENVIRONMENT,
    scope: "com.intuit.quickbooks.accounting",
    minorVersion: "73",
    authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    revokeUrl: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
    apiBaseUrl: isSandbox
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com",
  };
}
