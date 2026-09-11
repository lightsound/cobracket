Review the current change set for Solid 2.0 correctness. This project bans React patterns
and Solid 1.x APIs; the mechanical gates catch tokens, but several failure classes are
semantic and need your judgment.

Steps:

1. Run the gates and fix anything they report first:
   - `node node_modules/solid2-agent-kit/bin/solid2-kit.mjs check`
   - `node node_modules/solid2-agent-kit/bin/solid2-kit.mjs doctor`
2. Read the `solid-2` skill (`.cursor/skills/solid-2/SKILL.md` or
   `.claude/skills/solid-2/SKILL.md`) and its final review checklist.
3. Collect the diff under review: staged/uncommitted changes if any, otherwise the branch
   diff against the default branch.
4. Review every changed `.tsx`/`.jsx`/`.ts` file against the checklist, prioritizing what
   regexes cannot see:
   - reactive reads at component-body top level, or extracted into plain `const`s;
   - async computations reading reactive inputs **after** the first `await`;
   - effects that copy state instead of deriving it, or reading stores in the apply phase;
   - `<For>` over server/refetched rows without a stable-id key function;
   - core `action` bodies that are not generators (plain `async` functions) or that write
     after a bare `await` without re-entering on `yield` (router `action` from
     `@solidjs/router` is the one that takes `async (form) => ...`);
   - `<Loading>`/`<Errored>` wrapping page chrome instead of the data slot, or
     `const u = user()` extracted then passed (a real parent-side read). Passing
     `user={user()}` is the colorless form — do not "fix" it into accessors or
     `Promise<User>` props;
   - `latest(selectedId)` as the default highlight (hold is the default);
     `isPending` treated as a global spinner instead of a per-expression question;
   - treating `<Errored>` as a terminal ErrorBoundary, or routing per-row mutation
     failures through it (those belong in the action / a projection-folded map);
   - nested fetches assumed to waterfall, or `<Loading>` lifted along with a lifted fetch;
   - rewriting App with loading/error branches, or snapshot/restore, when wrapping
     a client store in server functions; disabling optimistic rows until ack;
   - tRPC / type-gen around `"use server"`, a client `fetch` after a mutation,
     refetch in `hydrate`/`onSettled`, a custom Worker/Express adapter, or
     delaying `renderToStream` for visual order (`<Reveal>` owns display);
   - store updates that rebuild objects/arrays instead of mutating the draft or reconciling
     (`filter` for removal is fine — survivors keep identity; only fresh-tree wholesale
     replacement needs `reconcile` / the derived form);
   - hand-rolled link-active comparisons (`location.pathname === ...`) instead of the
     automatic `aria-current` / `data-active` / `data-pending` attributes (+ CSS) or
     `useLinkState` / `useIsRouting`; hand-rolled query parsing instead of
     `useSearchParams`;
   - search inputs bound to a held value without `latest`, effect-based debounce, fully
     controlled forms without `name`s, `{ success: false }` result objects instead of
     thrown failures, or router forms without server-side validation (`throw respond(...)`)
     and `useSubmissions` inline errors;
   - browser-only *values* handled with a `clientOnly` component split or an `isServer`
     branch instead of `ssrSource: "client"` / `"hybrid"` on the memo/signal/derived store;
   - held writes with no feedback (`isPending` / `latest` / optimistic value / `affects()`)
     — the `[SILENT_HOLD]` shape — and dev-console diagnostics (`[STRICT_READ_UNTRACKED]`,
     attribution-only store/list/effect costs) left unaddressed;
   - context values passed as snapshots instead of accessors/setters/stores;
   - components with conditional/early returns on reactive values.
5. Verify any API you are not certain about against the official docs mirror
   (`https://v2-rebuild--solid-docs-v2.netlify.app/llms.txt`); never trust Solid 1.x or
   React memory.

Report each finding as `file:line — problem — Solid 2 replacement`, then fix them. Finish
by re-running the gates and the project's typecheck.
