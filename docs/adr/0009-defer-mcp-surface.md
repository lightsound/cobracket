# Defer the MCP surface until Events exist (or real demand appears)

With the MVP web UI shipped on top of the operations API, stories 18–20 (MCP tokens and the MCP server) are buildable at any time as the thin wrapper ADR 0001 prescribes — and we defer building them. The MVP success milestone (one real community tournament run end to end) needs only the web UI; mid-tournament operation is genuinely faster by clicking the bracket than by describing results in chat; and the conversational surface becomes valuable when there is more to talk about than result entry — which is what Event hosting (scheduling, Tracks, registration) brings. Until then, an MCP server would add a new security surface (token issuance, storage, revocation) with no users on the other end.

This amends the timing of ADR 0001, not its substance. The ordering of chat surfaces (MCP first, Discord bot second, in-app assistant last) and the structural constraint — one operations API, every chat surface a thin client of it — both stand, and the code keeps the seams warm: `convex/auth.ts` resolves every identity through `getOrganizer` (written to absorb token auth as a local edit), and the operations handlers remain the single home of Organizer capabilities. Deferral therefore costs little later; building now would only buy positioning with no one to position to.

Revisit when the first of these happens: Event hosting lands (the north-star loop's chat-operable container), a real tournament produces a concrete "I would have done this from chat" signal, or someone asks for programmatic access (the same token work serves an API).

## Consequences

- Stories 18–20 are annotated as deferred in `docs/specs/mvp.md`; the MVP slice ships without a chat surface.
- The near-term plan toward the first milestone is recorded in `docs/vision.md` (production deployment → small operational gaps → Share Link OGP; a deliberate UI/UX overhaul once features settle, with the mobile experience alongside or after it).
