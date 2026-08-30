import { defineApp } from "convex/server";
import { v } from "convex/values";
import authCore from "@convex-dev/auth/core/convex.config.js";
import authAnonymous from "@convex-dev/auth/providers/anonymous/convex.config.js";

// Convex Auth v2 (preview, ADR 0003): the core component owns the signing
// key, account<->user mapping, and sessions; the anonymous provider is the
// only sign-in method in MVP. Keys are deployment env vars set headlessly by
// `bun run auth:keys` (see scripts/setup-auth-keys.ts).
const app = defineApp({
  env: {
    AUTH_PRIVATE_KEY: v.string(),
    AUTH_JWKS: v.string(),
  },
});

app.use(authCore, {
  // Serves <CONVEX_SITE_URL>/auth/.well-known/jwks.json, which
  // auth.config.ts names as the JWKS URL.
  httpPrefix: "/auth",
  env: {
    AUTH_PRIVATE_KEY: app.env.AUTH_PRIVATE_KEY,
    AUTH_JWKS: app.env.AUTH_JWKS,
  },
});
app.use(authAnonymous);

export default app;
