# CLAUDE.md

Project guidance for Claude Code.

## Project context

cobracket hosts and manages tournaments of any format, from the web or from chat (MCP). Direction: `docs/vision.md`. Domain glossary: `CONTEXT.md` — use its terms in code, docs, and commits. Decisions: `docs/adr/`. Current spec: `docs/specs/mvp.md`.

<!-- solid2-agent-kit:solid-rules:start -->
<!-- Managed by solid2-agent-kit v0.3.1. Do not edit inside this block; run `solid2-kit sync` to update. -->

# Solid 2.0 — not React, not Solid 1.x

This project uses Solid 2.0 (`solid-js` 2.x). The JSX looks like React but the
execution model is different: **a component function runs exactly once, at mount**. Updates
flow from signals/stores directly to the JSX expressions that read them. Components never
re-render. Solid 2.0 is also **incompatible with Solid 1.x** — treat all Solid 1.x knowledge
(pre-2.0 tutorials, blog posts, Stack Overflow answers) as wrong for this codebase.

Before writing non-trivial Solid code, read the `solid-2` skill
(`.cursor/skills/solid-2/SKILL.md` for Cursor, `.claude/skills/solid-2/SKILL.md` for
Claude Code) for full patterns, decision tables, and official documentation URLs.

## Hard rules (React reflexes to unlearn)

1. **Never destructure props.** `function C({ name })` and `const { name } = props` read the
   prop getter once at setup and kill reactivity. Keep `props.x` and read it inside JSX, a
   memo, or an effect compute function. Defaults go at the read site: `props.x ?? fallback`.
   Rule of thumb: the string `props.` must never appear at component-body top level.
   Mechanically enforced by `solid2-kit check` — run it after editing TSX.
2. **Never read reactive values at component-body top level.** The body runs once, untracked;
   `const v = count()` there is a frozen snapshot (Solid warns in dev). Carry the accessor
   (the function itself) into JSX and call it there.
3. Signals are read by **calling** them: `{count()}` in JSX, not `{count}`.
4. **Derived state is a function, not state + effect.** `const full = () => a() + b()`.
   Never write "a signal plus an effect that syncs it". Use `createMemo` only for expensive
   computations, multiple consumers, or an equality boundary.
5. `class`, not `className`; `for`, not `htmlFor`. `class` accepts strings, conditional
   objects, and nested arrays: `class={["btn", { active: selected() }]}`. `style` objects use
   CSS property names (`"background-color"`, not `backgroundColor`) and numbers do NOT
   auto-append `px`.
6. **`onInput` for per-keystroke handling.** Solid's `onChange` is the native change event
   (fires on blur/commit), not React's per-keystroke `onChange`. Handlers receive native DOM
   events and run untracked — reading a signal inside a handler always gives the current
   value (stale closures cannot happen; `useCallback` equivalents are unnecessary).
7. **Lists use `<For>`**, never bare `.map()` in reactive JSX and never `key` props.
   Row identity: default = item reference; `keyed={(item) => item.id}` = key function
   (child receives item as an accessor); `keyed={false}` = positional. **Rows from
   server/refetched data (fresh object references on every update — fetch results,
   subscription payloads) must use a key function on a stable id**, or every update
   recreates every row. Reference keying is for local arrays whose item identities are
   stable (e.g. store rows). Fixed-count / windowed rendering uses `<Repeat>`.
8. **Effects have two phases**: `createEffect(compute, apply)`. All reactive reads go in
   `compute`; its return value feeds `apply`, which does imperative work and may return a
   cleanup. Single-argument `createEffect(fn)` is an error in Solid 2. Most React
   `useEffect` code should not become an effect at all — see the skill.
9. **Stores update by mutating a draft**: `setStore(draft => { draft.user.name = "Ada" })`.
   Never rebuild with spreads — that destroys property-level subscriptions.
10. **Async data is an async computation**: `createMemo(async () => ...)` read under
    `<Loading>` / `<Errored>` boundaries. No `useEffect` + `setState` fetching, no
    `createResource`. "Prop with local edits" = writable derivation:
    `createSignal(() => props.value)` or `createStore(() => props.value, fallback)`.
11. Context: the context object is the provider — `<MyContext value={{ theme, setTheme }}>`
    (no `.Provider`). Pass accessors/setters/stores through context, never snapshot values.
    `createContext<T>()` without a default throws when read outside a provider (good).
12. Refs: `let el!: HTMLDivElement` + `ref={(node) => (el = node)}`, or forward `props.ref`.
    Compose with arrays: `ref={[props.ref, (node) => (el = node)]}`. No `useRef`/`.current`.
13. **Writes are staged** and commit on the next microtask. Event handlers need nothing
    special; tests and imperative integration code must call `flush()` before observing
    updated state or DOM. Never call `flush()` inside an `action`.
14. Do not port these React tools — they have no Solid equivalent because the problems they
    solve don't exist: `useCallback`, `React.memo`, `forwardRef`, `useSyncExternalStore`,
    dependency arrays, `startTransition`/`useTransition` (updates are held and coordinated
    automatically; use `isPending` for indicators).
15. **Components return once.** Never early-return or conditionally return based on reactive
    values — the branch is chosen once at setup and frozen forever. Put conditionals inside
    JSX (`<Show>`, ternary, `<Switch>`/`<Match>`). Early returns on genuinely non-reactive
    values (build-time config, missing env) are fine.
16. Prefer `textContent` for text-only content. Use `innerHTML` only for trusted or
    sanitized markup — never interpolate user input into it.
17. **Never narrow a reactive read with a non-null assertion** (`error()!.message`,
    `user()!`). Use `<Show when={value()}>` with a function child — it passes a
    **narrowed accessor**, so no `!` is needed:
    `<Show when={error()}>{(err) => <p>{err().message}</p>}</Show>`. For non-reactive
    zero-arg calls, use an explicit guard variable instead of `!`.
    Mechanically enforced by `solid2-kit check`.
18. **Never hand-roll async UI state.** No `[loading, setLoading]` signals, no
    `data() === undefined` readiness branches, no `{ data, error }` signal pairs from
    integration layers. Model async as a computation (return a promise or async iterable
    from a memo/store) and let the framework own the states: first load = `<Loading>`
    fallback; refetch indicator = `isPending()`; errors = thrown into the graph and caught
    by `<Errored>`; speculative value = `latest()`. Mechanically enforced by
    `solid2-kit check` (loading-signal naming, zero-arg-call undefined checks).
19. **Refetch is `refresh(source)`** — rarely needed, but when it is, never fake it with a
    counter/version signal read inside the computation. Input-driven refetch is automatic
    (tracked inputs re-run the computation) and subscriptions push. Legit uses: after a
    mutation inside an `action`, and explicit reload buttons. Pair with `affects(source)`
    when the reload should present as pending.
20. **External collections flow into stores through reconciliation.** First choice:
    function-form `createStore(() => source, fallback)` / `createProjection` (reconcile
    automatically, keyed by `"id"`). Manual merge: `setStore(reconcile(fresh, "id"))` or
    apply `reconcile(fresh, "id")(draft.slot)` inside a draft setter. Plain wholesale
    assignment (`draft.todos = fresh`) renders correctly but notifies every subscriber
    under the path and destroys row identity — same class of problem as unkeyed `<For>`.
21. **Solid inputs do not rewind the DOM.** `value={v()}` writes only when `v` changes; a
    React-style controlled input that ignores invalid keystrokes silently breaks. To reject
    input, write back explicitly:
    `onInput={(e) => { if (valid(e.currentTarget.value)) setV(e.currentTarget.value); else e.currentTarget.value = v(); }}`.
22. Miscellaneous defaults: SSR-stable element ids come from `createUniqueId()` (never
    `Math.random()` or hardcoded duplicates); pass store data to `structuredClone` /
    `postMessage` / logs via `snapshot(store)` (proxies fail or leak reactivity); render
    modals/tooltips/overlays through `<Portal>` from `@solidjs/web`; mutations whose writes
    cross an async gap default to `action` + `createOptimistic`/`createOptimisticStore` —
    except reactive clients (e.g. Convex) whose subscriptions already push authoritative
    state after mutations.

## Lint heritage: eslint-plugin-solid (Solid 1.x) intents carried into this file

`eslint-plugin-solid` targets Solid 1.x. **Do not install it** — its analyzer predates the
Solid 2 model and misreads two-phase `createEffect`, writable derivations
(`createSignal(fn)`), and draft setters as errors. Its still-valid intents are enforced here
instead, and `solid2-kit check` checks the mechanically detectable ones on the source
directory (default `src/`).

| 1.x lint rule | Status in Solid 2 | Where |
|---|---|---|
| `solid/no-destructure` | still critical | rule 1 + `solid2-kit check` |
| `solid/reactivity` | still critical | rules 2–3 (+ Solid 2 dev-mode warnings) |
| `solid/components-return-once` | still valid | rule 15 |
| `solid/no-react-specific-props` | still valid | rule 5 + `solid2-kit check` |
| `solid/no-react-deps` | still valid — never pass React-style dependency arrays | rule 8 + `solid2-kit check` react-hook check |
| `solid/prefer-for` | still valid | rule 7 |
| `solid/prefer-show` | now a recommended default when narrowing | rule 17 + `solid2-kit check` |
| `solid/no-innerhtml` | still valid | rule 16 |
| `solid/style-prop` | still valid | rule 5 + `solid2-kit check` |
| `solid/imports` | changed paths | banned-API table + `solid2-kit check` |
| `solid/event-handlers` | still valid | rule 6 |
| `solid/jsx-no-undef`, `jsx-no-duplicate-props` | covered by TypeScript | project typecheck |
| `solid/prefer-classlist` | obsolete — `classList` removed | `solid2-kit check` bans `classList` |
| `solid/no-unknown-namespaces` | obsolete — `on:`/`use:`/`attr:` removed in 2.0 | banned-API table |
| `solid/no-proxy-apis` | obsolete — Solid 2 requires Proxy | not carried |

## Banned Solid 1.x APIs (Solid 2 replacements)

| Never write (Solid 1.x) | Write instead (Solid 2) |
|---|---|
| `import ... from "solid-js/store"` or `"solid-js/web"` | stores/`merge`/`omit` from `"solid-js"`; `render`/`hydrate`/`Portal`/`Dynamic` from `"@solidjs/web"` |
| `createResource` | async `createMemo` + `<Loading>`/`<Errored>`; `refresh()`, `latest()`, `isPending()` |
| `createEffect(fn)` (one arg), `on(...)` | `createEffect(compute, apply)`; deps belong in `compute` |
| `onMount` | `onSettled` (return cleanup from its callback) |
| `batch(...)` | delete it — writes auto-batch; `flush()` only to observe synchronously |
| `<Suspense>`, `<ErrorBoundary>`, `<SuspenseList>` | `<Loading>`, `<Errored>` (fallback gets an error *accessor*), `<Reveal>` |
| `<Index>` | `<For keyed={false}>` |
| `<Ctx.Provider value={...}>` | `<Ctx value={...}>` |
| `setState("a", "b", value)` path setters, `produce(...)` | draft setter: `setState(draft => { ... })` |
| `mergeProps` / `splitProps` / `unwrap` | `merge` / `omit` / `snapshot` |
| `classList={...}` | `class` object/array form |
| `createMutable`, `modifyMutable` | `createStore` + draft setters |
| `createComputed`, `createSelector`, `createDeferred` | `createMemo`, `createProjection`, external scheduling |
| `startTransition`, `useTransition` | automatic held updates + `isPending` |
| `use:directive`, `on:`/`oncapture:`, `attr:`/`bool:`, `/*@once*/` | `ref` callbacks, camelCase event props, standard attributes, keep values reactive |
| `resource.loading` / `resource.error` | `<Loading>` boundary / `<Errored>` boundary |

When unsure about any API, verify against the official Solid 2.0 docs — fetchable URLs are
listed in `references/official-docs.md` next to the `solid-2` skill. Do not guess from
Solid 1.x or React memory.

<!-- solid2-agent-kit:solid-rules:end -->

<!-- fallow:agent-install v1 claude-import:start -->
@AGENTS.md
<!-- fallow:agent-install v1 claude-import:end -->
