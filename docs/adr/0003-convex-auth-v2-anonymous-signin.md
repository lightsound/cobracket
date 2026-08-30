# Adopt Convex Auth v2 (preview) with Anonymous Sign-In

Organizers must be able to create a tournament with zero sign-up friction. We adopt Convex Auth v2 — still a preview — and use its Anonymous Sign-In: an anonymous user owns the tournaments they create and can later be upgraded to a full account. The preview-stage risk is accepted deliberately: the project is not shipping to production imminently, we want to stay as close to Convex as possible, and first-class anonymous-to-account linking beats a hand-rolled secret management-link scheme.

## Consequences

- Auth is isolated behind a single module (e.g. `src/lib/auth`) that exposes only "who is the current Organizer"; ImportLint enforces the boundary. If Auth v2 stalls or changes shape, that one module is swapped (Convex Auth v1 or an external IdP) without touching the app.
- MCP clients cannot reuse the browser session, so the MCP server authenticates with a token issued from the web UI instead.
