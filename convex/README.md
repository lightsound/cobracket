# Convex functions

Queries and mutations live here. The schema is `schema.ts`; the operations API (every Organizer capability plus the Share Link read, ADR 0001) is `operations.ts`; the pure format engine is `format/`; auth is `auth.ts` (ADR 0003).

The browser client is `ConvexClient` from `convex/browser`, not React. See `src/lib/convex.ts` for how Solid 2 subscribes.

```bash
bun run convex:dev
```

See the [Convex docs](https://docs.convex.dev/functions) for details.
