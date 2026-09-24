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
   - treating `<Errored>` as a terminal ErrorBoundary, or expecting it to catch
     mutation failures (an error thrown out of an `action` reverts the overlay and
     rejects the call — catch it in the action / a projection-folded map, or `.catch`
     the call in the handler);
   - effect `apply` functions with expression bodies (`(t) => (document.title = t)`,
     `(v) => setX(v)`) — any return value but a cleanup halts reactivity; `onCleanup`
     inside `apply` (never runs) or inside `onSettled`, and memos/effects/`flush()`
     inside an `onSettled` callback (all throw);
   - writes to a store outside its setter (`todos.push(x)`, `todo.done = ...` — silently
     ignored) and `Map`/`Set`/`Date` fields mutated in a draft (not tracked);
   - app-wide state as a module-level signal/store instead of a provider at the root
     of `App` (shared across SSR requests);
   - value-form `createOptimisticStore([])` / `createOptimistic(v)` holding durable
     data (writes vanish on settle) instead of the function form refreshed after `yield`;
   - route `preload` returning data read as `props.data` (captured once per match)
     instead of `void getX(params.id)` + `createMemo(() => getX(props.params.id))`;
   - `throw redirect()` / `return reload()` in server functions called without Solid
     Router `action`/`query` (the caller gets a raw `Response` or `null`, never its
     data), and POST forms built on a bare function's `.url` (TS2339) instead of a
     router `action`;
     error reporting done as a side effect inside `fallback` instead of
     `configureClientErrors` / `configureServerErrors` / `render(fn, root, undefined, { onError })`
     (options are `render`'s 4th argument — a 3rd-argument object is `init`);
   - store setter callbacks that `await` (the draft closes when the callback returns —
     `[ASYNC_STORE_SETTER]`), store setters called at component-body top level, and
     `latest()` used as a null-safe read of an unsettled source;
   - nested fetches assumed to waterfall, or `<Loading>` lifted along with a lifted fetch;
   - mutations on a value read through `live()` that settle on `yield save()` alone or
     `refresh()` the live-derived store, instead of `yield until(predicate, { timeout })`
     for the stream's echo (the old value flashes back when the overlay drops);
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
5. If the change set touches stores, lists, async computations, actions, or effects, run
   the skill's development loop against the dev server: `/__solid/diagnostics` `begin` →
   exercise the changed UI → `whyDidRun` for the changed scopes / `costs` → `end`
   (`@solidjs/diagnostics` installed), or an `isDev`-guarded
   `attribution.enable({ log: false })` + `why()` / `costs()` / `feedback()`. Report
   every coded warning, the silent holds in `feedback().sources`, and the top
   `costs().scopes` entries as findings.
6. Verify any API you are not certain about against the official docs mirror
   (`https://v2-rebuild--solid-docs-v2.netlify.app/llms.txt`); never trust Solid 1.x or
   React memory.

Report each finding as `file:line — problem — Solid 2 replacement`, then fix them. Finish
by re-running the gates and the project's typecheck.
