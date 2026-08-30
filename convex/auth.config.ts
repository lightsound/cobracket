import { AuthConfig } from "convex/server";
import { env } from "./_generated/server";

// Trust the JWTs the mounted auth core component mints (issuer =
// CONVEX_SITE_URL, JWKS served by the component under /auth). Without this
// file ctx.auth.getUserIdentity() is always null — silently signed out.
export default {
  providers: [
    {
      type: "customJwt",
      applicationID: "convex",
      issuer: env.CONVEX_SITE_URL,
      jwks: `${env.CONVEX_SITE_URL}/auth/.well-known/jwks.json`,
      algorithm: "RS256",
    },
  ],
} satisfies AuthConfig;
