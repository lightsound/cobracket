import { AuthConfig } from "convex/server";

// Evaluated at deploy time in Node, not in the Convex runtime this tsconfig
// types ("types": [] keeps @types/node out) — declare the one global used.
declare const process: { env: { CONVEX_SITE_URL?: string } };

const siteUrl = process.env.CONVEX_SITE_URL;
if (siteUrl === undefined) {
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
