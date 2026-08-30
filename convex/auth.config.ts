import { AuthConfig } from "convex/server";
import { env } from "./_generated/server";

// The generated type promises the platform sets CONVEX_SITE_URL, but `env`
// is process.env at runtime — fail the deploy loudly rather than shipping
// providers with an undefined issuer, which rejects every JWT untraceably.
const siteUrl: string | undefined = env.CONVEX_SITE_URL;
if (!siteUrl) {
  throw new Error("CONVEX_SITE_URL is not available to auth.config.ts");
}

// Trust the JWTs the mounted auth core component mints (issuer =
// CONVEX_SITE_URL, JWKS served by the component under /auth). Without this
// file ctx.auth.getUserIdentity() is always null — silently signed out.
export default {
  providers: [
    {
      type: "customJwt",
      applicationID: "convex",
      issuer: siteUrl,
      jwks: `${siteUrl}/auth/.well-known/jwks.json`,
      algorithm: "RS256",
    },
  ],
} satisfies AuthConfig;
