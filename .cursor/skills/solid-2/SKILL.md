---
name: solid-2
description: Write correct Solid 2.0 code (components, signals, stores, effects, async, JSX). Use whenever creating or editing .tsx files, reviewing UI code, or answering questions about Solid in this repo. Solid 2.0 is NOT React and NOT Solid 1.x — this skill prevents both classes of mistakes.
---

# Writing Solid 2.0

This project uses Solid 2.0 (`solid-js` 2.x) with `@solidjs/web`. The hard rules are
installed by solid2-agent-kit as an always-applied rules file (`.cursor/rules/solid-2.mdc`
for Cursor; a managed block in `CLAUDE.md` for Claude Code). This skill adds the mental
model, decision tables, and canonical patterns. When an API is in doubt, verify against the
official docs — see [Checking the official docs](#checking-the-official-docs).

## The one difference everything follows from

React re-runs component functions to compute the next UI. **Solid runs a component function
once, at mount.** After that, signals and stores notify only the computations and JSX
expressions that read them. There is no re-render, no reconciliation of component output,
no snapshot props, no stale closures, no dependency arrays.

Practical consequences:

- Values must travel as **accessors (functions)**, not as extracted values. Extracting a
  value at component-body top level freezes it forever.
- The component body is **untracked**. Tracking scopes are: JSX expressions, `createMemo`
  compute, `createEffect` compute (first argument), and boundary children.
- Event handlers run untracked: they always read current values and never subscribe.
- Object identity is stable: handlers, context values, and props objects are created once.
  `useCallback` / `useMemo`-for-identity / `React.memo` have no purpose here.

## Decision tables

### Where does state live?

| Situation | Use |
|---|---|
| Scalar local state (count, open/closed, text input) | `createSignal(value)` in the component |
| Object/array state where parts update independently (forms, lists, nested data) | `createStore(value)` — property-level subscriptions |
| Object that is replaced wholesale (fetch response, selected item, `User \| null`) | `createSignal(objectValue)` |
| Value derived from other reactive values | plain function `() => ...` (never a signal synced by an effect) |
| Expensive derivation, multiple consumers, or equality boundary needed | `createMemo(() => ...)` |
| Follows a prop but user can locally override; prop change resets | writable derivation: `createSignal(() => props.value)` / `createStore(() => props.value, fallback)` |
| Shared by a subtree, independent per provider instance | signal/store created inside a provider component, passed via context |
| Truly app-wide singleton (theme, session, locale) | module-level signal/store (beware SSR: module state is shared across requests) |
| Tentative value during a mutation | `createOptimistic` / `createOptimisticStore` + `action` |
| Values pushed by an external subscription (websocket, reactive client) | async iterable returned from a memo (or function-form `createStore` for keyed reconciliation) — never `{ data, error }` signal pairs |

### Should this be an effect?

Most React `useEffect` code should NOT become `createEffect`:

| React habit | Solid 2 |
|---|---|
| Compute a rendered value in an effect | plain function or `createMemo` |
| Fetch data in an effect, copy into state | `createMemo(async () => ...)` + `<Loading>` |
| React to a user interaction | do the work in the event handler or an `action` |
| Sync one state into another | delete the second state; derive it |
| Reset/clear state when another reactive value changes | writable derivation: `createSignal(() => { source(); return initial; })` — not an effect calling the setter |
| Push a settled reactive value into a non-Solid system (DOM API, third-party widget, analytics, subscription) | `createEffect(compute, apply)` — this is the only real use |
| One-time setup after mount (`onMount`) | `onSettled(() => { ...; return cleanup })` |
| Measure DOM / observe size after paint | ref **directive factory** + `onSettled` (writes a *new* input; not an effect that copies state) |

### Composition, code-splitting, SSR

| Situation | Use |
|---|---|
| Wrapper that only renders its children | `{props.children}` — no helper |
| Inspect, count, or iterate children | `children(() => props.children)` then `.toArray()` |
| Code-split a component | `lazy(() => import("./X"))` read under `<Loading>` |
| Named export from a lazy module | `lazy(() => import("./pages"), { export: "About" })` |
| Pick a component/tag from reactive state | `dynamic(() => ...)` from `@solidjs/web` (stable identity; prefer over `<Dynamic>`) |
| Overlay / modal | `<Portal>` — hoist async reads *above* the portal (reads inside start on the client) |
| Browser-only widget (charts, maps, `window`) | `clientOnly(() => import("./Chart"))` from `@solidjs/web` (`{ lazy: true }` defers the import until first render) |
| Server vs browser branch | `isServer` / `isDev` from `@solidjs/web` (build-time constants), not `typeof window` |
| SSR-stable `id` / `for` / `aria-*` pairing | `createUniqueId()` |

## Canonical patterns

### Component with local state and derived value

```tsx
import { createSignal } from 'solid-js';

function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = () => count() * 2; // derivation: a function, not a memo, not an effect

  return (
    <button onClick={() => setCount((c) => c + 1)}>
      {count()} x 2 = {doubled()}
    </button>
  );
}
```

### Props: read late, never destructure

```tsx
// CORRECT — reads happen inside JSX (a tracking scope)
function Greeting(props: { name: string; punctuation?: string }) {
  return <p>Hello, {props.name}{props.punctuation ?? '.'}</p>;
}

// WRONG — reads the getter once at setup; never updates again
function Greeting({ name }: { name: string }) { /* ... */ }
```

To give a derived prop a local name, name the *function* (or `createMemo` if expensive):

```tsx
const full = () => `${props.first} ${props.last}`;
```

To merge defaults or split props reactively use `merge` / `omit` from `solid-js`
(replacements for Solid 1.x `mergeProps` / `splitProps`). `merge` is like
`Object.assign`: an explicit `undefined` **overrides** the previous source.
Omitted keys still fall through, so `merge({ type: "button" }, props)` is the
usual defaults pattern. That is not Solid 1 `mergeProps`, which ignored
`undefined`. Forwarding leftover props: `const rest = omit(props, "label")` then
`<input {...rest} />`. `const rest = { ...props }` compiles and then never updates.

### Store updates (draft mutation)

```tsx
import { createStore } from 'solid-js';

const [profile, setProfile] = createStore({ name: 'Ada', role: 'Engineer' });

setProfile((draft) => {
  draft.name = 'Grace'; // only readers of .name re-run
});
```

**External collections enter stores through reconciliation, never wholesale assignment.**
`draft.todos = serverTodos` renders correctly but replaces every object identity — all
subscribers under the path re-run and row identity is lost. In order of preference:

1. Function-form `createStore(() => source, fallback)` or `createProjection` — reconcile
   automatically (keyed by `"id"`), surviving items keep proxy identity.
2. Manual merge: `setTodos(reconcile(fresh, 'id'))`, or on a nested slot
   `setState((draft) => { reconcile(fresh, 'id')(draft.todos); })`. Positional data
   (fixed-shape dashboards): `reconcile(next, null)`.

Plain non-reactive copy for logging/serialization/`structuredClone`: `snapshot(store)`.
Subscribe an effect compute to every nested change: `deep(store)`.

### Children: pass through, or resolve with `children()`

Most wrappers just render `props.children`. Use the `children` helper only when
the component must **inspect or iterate** them. It returns an accessor with
`.toArray()`. The helper call belongs in the component body; the read of
`props.children` is inside the accessor (a tracking scope), so this is not a
setup-time snapshot. Do not assign `const kids = props.children` and do not
treat resolved children as a reactive data list for `<For>` —
render `{resolved.toArray()}`, not `<For each={resolved()}>`:

```tsx
import { children, type ParentProps } from 'solid-js';

function Stack(props: ParentProps) {
  const resolved = children(() => props.children);
  return <div class="stack">{resolved.toArray()}</div>;
}
```

### Code-splitting: `lazy` + `<Loading>`

```tsx
import { lazy, Loading } from 'solid-js';

const Profile = lazy(() => import('./Profile'));
const About = lazy(() => import('./pages'), { export: 'About' });

<Loading fallback={<Spinner />}>
  <Profile id="42" />
</Loading>

<button type="button" onMouseEnter={() => Profile.preload()}>Open profile</button>
```

Never `React.lazy` / `<Suspense>`. The lazy component suspends through
`<Loading>` on first render; `.preload()` starts the import early. Named
exports must use `{ export: "About" }` — a `.then((m) => ({ default: m.About }))`
wrapper hydrates incorrectly (the name is not a call-site literal).

### Dynamic component: `dynamic()` (canonical)

```tsx
import { createSignal, type Component } from 'solid-js';
import { dynamic } from '@solidjs/web';

const Compact: Component<{ value: string }> = (props) => <span>{props.value}</span>;
const Detailed: Component<{ value: string }> = (props) => <strong>{props.value}</strong>;

const [detailed, setDetailed] = createSignal(false);
const Result = dynamic(() => (detailed() ? Detailed : Compact));

<Result value="Current result" />
```

`dynamic()` returns a **stable** component whose source can be a component, an
intrinsic tag name, a promise, or empty. Prefer it over swapping a component
variable in JSX (`const View = tab() ? A : B` freezes the choice at setup).
`<Dynamic>` is the JSX spelling of the same primitive; application code should
use `dynamic()` so the component identity stays stable.

### Two-phase effect (imperative boundary only)

```tsx
import { createEffect } from 'solid-js';

createEffect(
  () => props.roomId,          // compute: ALL reactive reads here; return value feeds apply
  (roomId) => {                // apply: untracked imperative work
    const connection = chat.connect(roomId);
    return () => connection.close(); // cleanup before next run / on disposal
  },
);
```

Reads inside `apply` do not track. Extract every needed reactive value in `compute`
(e.g. `() => ({ name: user.name, role: user.role })`). Passing a store proxy into `apply`
and reading `user.name` there *runs once* and never retriggers. Compute-phase errors can be
intercepted with the bundle form `createEffect(compute, { effect, error })`.

A two-phase effect whose apply only calls a local signal setter is "state + effect" in
disguise — formally legal Solid 2, still rule 4 (`solid2-kit check` flags it). The reset
form of a writable derivation replaces it, and moves the source read to the read site
(under that site's boundaries) instead of an effect compute:

```tsx
// WRONG — signal synced by an effect; organizer() errors bypass the read site's <Errored>
const [signInError, setSignInError] = createSignal<string | null>(null);
createEffect(
  () => organizer(),
  (id) => {
    if (id !== null) setSignInError(null);
  },
);

// CORRECT — writable derivation: resets when organizer() changes; the setter still works
const [signInError, setSignInError] = createSignal<string | null>(() => {
  organizer();
  return null;
});
```

### Async data

```tsx
import { Errored, For, Loading, createMemo, createSignal } from 'solid-js';

const [query, setQuery] = createSignal('');
const results = createMemo(async () => {
  const value = query().trim();
  if (!value) return [];
  return api.search(value);
});

return (
  <Errored fallback={(error) => <p>{String(error())}</p>}>
    <Loading fallback={<p>Searching...</p>}>
      <ul><For each={results()}>{(r) => <li>{r.title}</li>}</For></ul>
    </Loading>
  </Errored>
);
```

- The `<Loading>` boundary must be an owner ancestor of the **read** (`results()`), not of
  where the memo was created, and not of page chrome (header/nav) that should stay mounted.
  Boundary placement is purely a UX decision — it does not change when fetches start
  (no waterfalls: nested components set up and fetch in parallel). After first paint the
  boundary keeps settled content during refetch; `isPending(results)` (pass the accessor,
  not `isPending(results())`) is the
  indicator. Use `on={query()}` (the **value**, not the accessor `on={query}`) only when
  that identity should put the fallback back on screen.
  Do not use `isPending` as the first-load spinner.
- Read every reactive input **before the first `await`** in an async computation. A read
  after `await` does not subscribe; production can sit pending with no retry.
- `<Errored>` function fallbacks receive an error **accessor** and a `reset` callback:
  `fallback={(error, reset) => ...}`.
- Refetch: `refresh(results)`. In-flight indicator: `isPending(results)` (or
  `isPending(() => results())`). Freshest in-flight value for a preview:
  `latest(results)`. Do not start `fetch` at component-body top level.
- Coordinate reveal order of sibling `<Loading>` boundaries with `<Reveal order="sequential" | "together" | "natural">`.

**Never hand-roll these states.** No `[loading, setLoading]` signal, no
`data() === undefined` branch, no `{ data, error }` signal pair — those are React/Solid 1.x
reflexes that bypass the async model and `solid2-kit check` flags them. If a value is async,
make it an async computation and read it under boundaries. Refetching is `refresh(source)`
(typically as the last step of a mutation `action`, or a reload button) — never a
counter/version signal read inside the computation to force re-runs; input-driven refetch is
already automatic.

**Normalize thrown values once.** Thrown values are `unknown` in JavaScript, so define one
shared `ErrorFallback` component per app — extract the message via `instanceof Error`, wire
`reset` to a Retry affordance — and pass it to every `<Errored fallback>`, instead of
repeating `String(error())` at each boundary:

```tsx
<Errored fallback={(error, reset) => <ErrorFallback error={error} reset={reset} />}>
```

### Streams and subscriptions (websockets, reactive clients)

Push-based sources integrate by returning an **async iterable** from a computation — reads
then suspend to `<Loading>` until the first value, later pushes update the settled value,
and thrown errors reach `<Errored>`. Integration layers should return a plain accessor, not
`{ data, error }` signals:

```tsx
import { createMemo, onCleanup } from 'solid-js';

function createSubscriptionQuery<T>(
  subscribe: (next: (value: T) => void, fail: (error: unknown) => void) => () => void,
) {
  const queue: T[] = [];
  let failure: unknown;
  let wake = () => {};
  // Custom primitive: unsubscribe is tied to the caller's owner via onCleanup.
  // Component bodies use onSettled and return cleanup instead.
  onCleanup(subscribe(
    (value) => { queue.push(value); wake(); },
    (error) => { failure = error; wake(); },
  ));

  return createMemo(() => (async function* () {
    while (true) {
      if (failure !== undefined) throw failure;
      if (queue.length > 0) { yield queue.shift() as T; continue; }
      await new Promise<void>((resolve) => { wake = resolve; });
    }
  })());
}
```

### Mutations: `action` + optimistic state

```tsx
import { action, createOptimisticStore, refresh } from 'solid-js';

const [todos, setTodos] = createOptimisticStore(fetchTodos, []);

const addTodo = action(function* (todo: Todo) {
  setTodos((draft) => { draft.push(todo); }); // optimistic, auto-reverts on failure
  yield saveTodo(todo);                        // yield promises to stay in the transaction
  refresh(todos);
});
// invoke from an event handler: onClick={() => void addTodo(newTodo)}
```

Ordinary signal/store writes inside an action are held until it settles. Never call
`flush()` inside an action. Invoke actions from handlers, not from component/computation bodies.
Do not set a `submitted` signal and watch it from an effect — that work belongs in the
handler or the `action`.

`createOptimistic` / `createOptimisticStore` are for a tentative value during an
active mutation, not a local editing session (use a writable derivation or a plain
store for that).

**`yield`, not a bare `await`, is the transaction boundary.** `await api.save()` then
`setTodos(...)` *runs*, but the write commits immediately and optimistic rollback is lost.
Either `yield saveTodo(todo)` or, when you need a typed result, `const saved = await api.save(); yield; setTodos(...)`.

Navigation-shaped updates do **not** need core `action`. A plain setter is enough:
reads pull the async, and downstream async computeds hold previous values until the
new ones are ready (`isPending` / `latest`). Reach for `action` from `solid-js` only
when writes happen *after* async work. Router form `action` from `@solidjs/router` is
a different API (URL + POST) — see [App stack](#app-stack-only-if-the-project-has-these-packages).

### Lists: `<For>` child signatures per keying mode

```tsx
// Default (keyed by item reference): item is the RAW value, index is an accessor
<For each={todos()}>{(todo, index) => <Row todo={todo} n={index()} />}</For>

// Key function: BOTH are accessors
<For each={todos()} keyed={(todo) => todo.id}>{(todo) => <Row todo={todo()} />}</For>

// Positional (Solid 1.x <Index>): item is an accessor, index is a plain number
<For each={cells()} keyed={false}>{(cell, i) => <Cell value={cell()} at={i} />}</For>
```

Choosing the keying mode:

| Where the rows come from | Mode |
|---|---|
| Server/refetched data — fetch results, subscription payloads (fresh object references on every update) | **key function on a stable id** (`keyed={(item) => item.id}`) — reference keying would recreate every row on each update |
| Local array whose item identities are stable (e.g. store rows, static lists) | default (item reference) |
| Fixed positions where only contents change | `keyed={false}` |

Never `{todos().map((t) => <Row todo={t} />)}` and never `<For each={todos().map(...)}>`.
The `.map` form *renders*; it just rebuilds every row. `children().toArray().map` is
fine — those nodes are already resolved.

`<Repeat from={start()} count={20}>{(index) => ...}</Repeat>` renders by absolute index with
no array diffing — use for fixed slot counts and virtual scrolling windows.

### Conditionals

Ternaries work and are reactive, but **when the truthy branch reads the tested value, use
`<Show>`**: its function child receives a narrowed accessor, so no non-null assertion is
needed. Never write `value()!` to narrow by hand (`solid2-kit check` flags it):

```tsx
// WRONG — hand narrowing with a non-null assertion
{error() ? <p>{error()!.message}</p> : <TaskList />}

// CORRECT — Show narrows; fallback holds the other branch
<Show when={error()} fallback={<TaskList />}>
  {(err) => <p>{err().message}</p>}
</Show>
```

```tsx
<Show when={user()} fallback={<SignIn />}>
  {(currentUser) => <Profile user={currentUser()} />} {/* narrowed ACCESSOR */}
</Show>
```

Plain ternaries remain fine when no narrowing is involved (`{open() ? <A /> : <B />}`).

Default `Show` keeps children mounted across truthy changes. Add `keyed` to remount when the
value's identity changes (child then receives the raw value, like React's `key` reset).
Prefer the default; use `keyed` only when internal state must reset. Multi-branch:
`<Switch>` / `<Match>` — **first truthy `<Match>` wins**; later matches are skipped,
even if they are also truthy.

Components must **return once**: never early-return based on a reactive value — the branch
is picked at setup and frozen. Early returns on non-reactive values (build-time config, a
missing environment variable) are fine.

### Input filtering (inputs do not rewind)

React's controlled inputs force the DOM back to the state value on every re-render, so
"ignore invalid keystrokes" works by simply not updating state. Solid has no re-render:
`value={v()}` writes the DOM only when `v` changes, so rejected characters **stay visible**
unless you rewind the DOM yourself:

```tsx
<input
  value={v()}
  onInput={(event) => {
    if (/^\d*$/.test(event.currentTarget.value)) setV(event.currentTarget.value);
    else event.currentTarget.value = v(); // reject: explicit write-back
  }}
/>
```

### Context

```tsx
import { createContext, createSignal, useContext } from 'solid-js';
import type { Accessor, ParentProps, Setter } from 'solid-js';

type Theme = 'light' | 'dark';

const ThemeContext = createContext<{ theme: Accessor<Theme>; setTheme: Setter<Theme> }>();

function ThemeProvider(props: ParentProps) {
  const [theme, setTheme] = createSignal<Theme>('light');
  return <ThemeContext value={{ theme, setTheme }}>{props.children}</ThemeContext>;
}

function ThemeButton() {
  const { theme, setTheme } = useContext(ThemeContext); // destructuring here is FINE
  return <button onClick={() => setTheme('dark')}>{theme()}</button>;
}
```

Pass accessors/setters/stores through context — never `value={theme()}` (a dead snapshot).
No `useMemo` for the value object, no context splitting: the object is created once and
fine-grained updates flow through the signals inside it. Context is **subtree scoping**.
A true app-wide singleton (theme, session, locale) is a module-level signal/store —
do not invent a root provider for that. Module state is shared across SSR requests.

### Refs

```tsx
import { onSettled, type Ref } from 'solid-js';

function listen(type: string, handler: EventListener, options?: AddEventListenerOptions) {
  let element: HTMLElement | undefined;
  onSettled(() => {
    const target = element;
    if (!target) return;
    target.addEventListener(type, handler, options);
    return () => target.removeEventListener(type, handler, options);
  });
  return (next: HTMLElement) => { element = next; };
}

function SearchField(props: { ref?: Ref<HTMLInputElement>; onInput: EventListener }) {
  let input!: HTMLInputElement;
  return (
    <>
      <input
        ref={[props.ref, (el) => (input = el), listen('input', props.onInput, { passive: true })]}
        type="search"
      />
      <button type="button" onClick={() => input.select()}>Select</button>
    </>
  );
}
```

Ref arrays flatten recursively; each callback runs in order. No `forwardRef` needed.

**Ref callbacks run untracked and without an owner.** Their return values are
ignored — do not create effects, memos, or `onCleanup` inside the callback, and
do not `return () => cleanup`. Put owned setup in a **directive factory** (like
`listen` above) and return only the element callback. Use this for
`ResizeObserver`, third-party widgets, and native listener options (`capture` /
`passive`) — Solid event props do not take those options.

## Scheduling and tests

Signal/store writes outside a synchronous flush scope are **staged**; the reactive queue
commits on the next microtask. Event handlers need nothing. Tests must flush:

```ts
setCount(2);
flush();
expect(count()).toBe(2);
```

Wait for an async expression to settle in tests: `await resolve(() => value())`.
`flush()` only drains staged **synchronous** writes — it is not a stand-in for waiting
on a pending resource. `onSettled` is also a **single** fire (untracked): it is not
`onMount` that re-runs, and it is not an effect. Run tests in dev mode first — Solid 2 emits diagnostics for top-level reactive reads,
writes from owned scopes, and async reads outside `<Loading>`. Fix them; don't suppress.

Component tests use `@solidjs/testing-library`. Pass a **function** to `render` so
the tree has an owner, and `flush()` after interactions that stage writes:

```tsx
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { afterEach, expect, test } from 'vitest';

afterEach(cleanup);

test('increments on click', () => {
  const { getByRole } = render(() => <Counter />);
  const button = getByRole('button');
  fireEvent.click(button);
  flush();
  expect(button).toHaveTextContent('Clicks: 1');
});
```

`jsxImportSource` for tests and app code is `"@solidjs/web"`, not `"solid-js"`.
Vite plugin is `@solidjs/vite-plugin`, not `vite-plugin-solid`.

To turn those dev diagnostics into a hard gate, patch `console.warn` in the test setup
file to rethrow unexpected warnings — then any top-level reactive read or unowned write
an agent sneaks in fails the suite instead of scrolling by.

## Client mode: no server HTML, no hydration reflexes

The `@solidjs/vite-plugin` default (client mode, the `bare` tier) serves an empty-body
shell and mounts with `render()`. Nothing is server-rendered and nothing hydrates, so
**React's hydration-mismatch playbook does not transfer**: do not start signals with a
"server-safe" initial value and adopt `localStorage` / `matchMedia` after mount, do not
two-pass render, and there is no `suppressHydrationWarning`. Read client sources directly
when creating state — `createSignal(storedPreference())` is correct in client mode. A
deferred "safe" initial value is worse than unnecessary: if anything persists the value
(an effect writing `localStorage`), the placeholder **overwrites the user's stored
preference** before the real value is adopted. Mismatch only becomes a concept in
start/SSR mode, where `hydrate()` mounts onto server HTML — and the Solid answer there is
`isServer` / `clientOnly`, still not React-style deferred adoption.

## App stack (only if the project has these packages)

This kit's always-applied rules cover `solid-js` + `@solidjs/web` TSX. Official
Solid 2 docs also describe optional app layers. **If those packages are in the
project, use them — do not invent Next.js, React Router, SolidStart 1.x, or
Solid Router 0.x/1.x stand-ins.** Patterns below; fetch the matching pages from
[references/official-docs.md](references/official-docs.md).

### Compiler / packages

```json
{ "compilerOptions": { "jsx": "preserve", "jsxImportSource": "@solidjs/web" } }
```

`solid-js` does **not** export a `JSX` namespace — `import type { JSX } from "solid-js"`
is a type error (TS2305), and `JSX.Element` as the children type is a React reflex.
Children/return types are the renderer-neutral `Element` from `solid-js`
(`children?: Element`), alongside `Component` / `ParentProps` / `Accessor` / `Setter`.
DOM-specific `JSX` types (`JSX.IntrinsicElements`, `JSX.CSSProperties`) and
`ComponentProps` come from `@solidjs/web`. Vite: `import solid from "@solidjs/vite-plugin"`
with `start: true` / `ssr: true` / `serverFunctions: true` only when the
project already uses start mode. Tiers are `bare` → `basic` (router) →
`fullstack` (SSR + server functions); do not jump a tier without cause.

### Solid Router 2 — `createRouter`, not JSX `<Route>`

```tsx
import { lazy } from 'solid-js';
import { createRouter } from '@solidjs/router';

export const Router = createRouter({
  routes: [
    { path: '/', component: lazy(() => import('./pages/Home')) },
    { path: '/about', component: lazy(() => import('./pages/About')) },
    { path: '*404', component: lazy(() => import('./pages/NotFound')) },
  ],
});
export const { paths } = Router;

export default function App() {
  return (
    <Router>
      {(props) => (
        <>
          <a href={Router.paths()}>Home</a>
          <main>{props.children}</main>
        </>
      )}
    </Router>
  );
}
```

Create the instance at **module scope**. Nested layouts are `children` arrays
on the route objects, not nested `<Route>` / nested routers. Solid Router does
**not** support nested `<Router>` instances — compose one route tree (or a lazy
`children` thunk). Navigate with
plain `<a href={Router.paths.about}>` (or `useNavigate`); there is no `<A>` /
`<Navigate>` / `<HashRouter>` / `<FileRoutes />`. Do not assign
`window.location.href` or call `history.pushState` for in-app navigation.
Session location is `useLocation` / `useParams`,
not `Router.paths`. A route `preload` result is `props.data` on the matched
component (and the factory `preload` result is the root render prop's `props.data`).
Link warming: `preload="false"` skips that link's *data* preload; `preloadLinks: false`
disables automatic link preloading. Intent values are `"initial"` / `"navigate"` /
`"native"` / `"preload"`. One router per app.

**Two different `action`s.** Core `action` from `solid-js` is a generator transaction
(optimistic writes that span an async gap). Router `action` from `@solidjs/router` is
a URL-addressable POST mutation (`useSubmissions`, `<form action={save} method="post">`).
Do not import one and use it as the other.

```tsx
import { action } from '@solidjs/router';
import { redirect } from '@solidjs/web';

const save = action(async (form: FormData) => {
  await saveProfile(form);
  return redirect('/account');
}, 'update-profile');

<form action={save} method="post">
  <input name="displayName" />
  <button type="submit">Save</button>
</form>
```

Only POST forms are accepted. Bind extra args with `.with(id)` (they go in the
action URL). `onSubmit={(e) => { e.preventDefault(); fetch(...) }}` *runs* and
drops the no-JS form fallback. `useAction` is JS-only for the same reason.

**`query` is the read cache** (optional, only with the router). Wrap a read,
give it a stable name, and consume it through a Solid async primitive:

```tsx
import { createMemo } from 'solid-js';
import { query, revalidate } from '@solidjs/router';

export const getUser = query(async (id: string) => {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
}, 'users');

const user = createMemo(() => getUser(params.id));
// after a mutation:
revalidate(getUser.key);
revalidate(getUser.keyFor('42'));
```

A bare `createMemo(async () => fetchUser(id()))` still works; it just has no
shared cache, no preload reuse, and no `revalidate`. Do not wrap mutations in
`query` — wrapping an undeclared server function makes it GET. `query.get(key)`
throws if there is no entry; `query.set` does not accept a promise. Cache is
request-scoped on the server and application-scoped in the browser. After a
router mutation, `revalidate(...)` — not core `refresh()`, and not
`reload()` (that is a *server-function return* that asks the integration to
refresh cached data: `return reload({ revalidate: "todos" })`). `live()` sources
update through the open stream; do not `revalidate` them. Replace SolidStart /
Router 0.x leftovers: no `createAsync`, `useSubmission` (singular), `cache()`,
router `json()`, or `<FileRoutes />` (`fileRoutes(pageRoutes)` instead).

### Server functions — `"use server"`

```ts
export async function findUser(id: string) {
  'use server';
  // validate `id`; read identity from getRequestEvent(), never from arguments
  return database.users.find(id);
}
```

A function-level server function cannot close over component locals — pass
values as arguments. Treat every argument as untrusted. Read trusted identity
from `getRequestEvent()`, never from a caller-supplied user id. During SSR the same
reference runs in-process; in the browser it is HTTP. Mutations that should
revalidate: `redirect` / `reload` from `@solidjs/web` (see the server-function
guides). For 404 during SSR: `httpStatus(404)` from `@solidjs/web`.
`throw new Error("…")` is stripped to `"Internal Server Error"` in production —
use `markSafeError` or `respond(..., { status })` for intentional client-facing
failures. Do not `return Response.json(...)` from `"use server"` — that is
HTTP-handler control flow; `respond(value, { status })` is what a scripted
caller unwraps. JSON-encodable arguments only unless `enableRichArguments()`
was called once in the client entry (`Date` / `Map` / `Set` throw without it).
`GET()` is only for idempotent reads (URLs leak into logs/history);
import it from `@solidjs/web/server-functions`, never `@solidjs/start`.
`live()` yields **current state** (each yield replaces the last); do not treat
it as an append-only event log, and hoist the memo so consumers share one
connection.
Unscripted forms: `<form method="post" action={createTodo.url}>` (the reference
`.url`), not a client `preventDefault` + `fetch`, and not a hand-built
`/_server/` URL. GET forms (`method="get" action={search.url}`) are only for
idempotent search — do not use a GET form for a mutation.

### Document head — no MetaProvider

```tsx
import { Title, Link, Meta } from '@solidjs/meta';

<Title>Page title</Title>
<Meta name="description" content="..." />
```

Solid Meta 1.x has **no provider**. Render tags anywhere; later wins, unmount
restores. `useHead` from `@solidjs/web` is the lower-level registry — prefer
`<Title>` / `<Meta>` / `<Script>` (JSON-LD) for application metadata. Several
tags that should swap as one unit belong in `<Head>`. A static `<title>`
in the document shell is the fallback when no `<Title>` is mounted; do not
hardcode a second `<meta name="description">` (the registry leaves foreign tags
alone, so both would coexist). Do not hardcode a second `<title>` in the document shell.

## These still run — write the other form

Official docs (and the compiler) allow several of these. They are the wrong
tool: they snapshot, drop subscriptions, or rebuild work Solid already knows
how to reuse. Prefer the form on the right.

| Compiles / renders | Write this |
|---|---|
| `{todos().map((t) => <Row todo={t} />)}` | `<For each={todos()} keyed={(t) => t.id}>` |
| `<For each={todos().map(t => t)}>` | derive first, then `<For each={visible()}>` |
| `class={`btn ${on() ? "on" : ""}`}` / `clsx("btn", on() && "on")` / `.filter(Boolean).join(" ")` | `class={["btn", { on: on() }]}` |
| `style={{ width: 80 }}` (no unit) | `style={{ width: `${80}px` }}` |
| `const rest = { ...props }` | `const rest = omit(props, "label")` |
| `const user = createMemo(async () => { await fetch(...); return id(); })` | read `id()` **before** `await` |
| `action(async function* () { await save(); setX(v); })` | `yield save()` or `await save(); yield; setX(v)` |
| `todos()` on a store | `todos.length` / `todo.title` (property reads) |
| `setTodos((t) => t.filter((x) => x.ok))` | mutate the draft, or `reconcile` |
| `createEffect(() => user, (u) => log(u.name))` | `createEffect(() => user.name, (name) => log(name))` |
| `<Loading fallback={<PageSkeleton />}>{/* header + data */}</Loading>` | wrap only the data slot; chrome stays outside |
| `<Loading on={id} fallback={...}>` (the accessor) | `on={id()}` — a value, so identity changes can show fallback |
| `setCount(count() + 1)` when writes can batch | `setCount((c) => c + 1)` |
| `setHandler(fn)` to store a function | `setHandler(() => fn)` (otherwise `fn` is an updater) |
| `{user() ? <P user={user()!} /> : <SignIn />}` | `<Show when={user()}>{(u) => <P user={u()} />}</Show>` |
| `<Child user={user()} />` for an async memo | `<Child user={user} />` and read `props.user()` under the child's `<Loading>` |
| `lazy(() => import("./p").then((m) => ({ default: m.About })))` | `lazy(() => import("./p"), { export: "About" })` |
| `dangerouslySetInnerHTML={{ __html }}` | `innerHTML={html()}` (sanitized); never with JSX children |
| `onClick={setCount}` | `onClick={() => setCount((c) => c + 1)}` |
| `event.target.value` | `event.currentTarget.value` |
| `createContext(emptyStore)` for reactive state | `createContext<Todos>()` — dummy defaults silently no-op |
| `<For keyed={(t) => t.id}>{(todo) => todo.title}` | `todo().title` — key-function items are accessors |
| `{list().length ? <For each={list()}> : <Empty />}` | `<For each={list()} fallback={<Empty />}>` |
| `<For each={rows.slice(from, from + n)}>` | `<Repeat from={from()} count={n}>` |
| `{count() && <Badge />}` | `<Show when={count()}>` — `0` must not render as text |
| `throw new Error("expired")` from a server function (prod) | `throw markSafeError(...)` or `throw respond(body, { status })` |
| `GET(async (id) => { "use server"; await db.delete(id) })` | mutations stay on POST; `GET()` is for idempotent reads |
| `live()` yields as an event log to append | each yield **replaces** the current answer; yield current state first |
| `<article innerHTML={html()}>…children…</article>` | `innerHTML` **or** children, not both |
| `fallback={(error) => <p>{error.message}</p>}` | `error` is an accessor: `error().message` (or `String(error())`) |
| `import { action } from "solid-js"` on a `<form>` | `import { action } from "@solidjs/router"` + `<form action={save} method="post">` (core `action` is a generator transaction, not a form URL) |
| `createMemo(async () => fetchUser(id()))` when `@solidjs/router` is present | `query(fetchUser, "users")` + `createMemo(() => getUser(id()))`; after mutations `revalidate(getUser.key)`, not core `refresh()` |
| `onSubmit={(e) => { e.preventDefault(); fetch(...) }}` for a router/server action | `<form action={save} method="post">` (POST only; `.with(id)` binds args into the URL). `useAction` is JS-only |
| `query(saveUser, "users")` wrapping a mutation | don't wrap mutations in `query` — an undeclared server function becomes GET |
| `render(<App />, root)` / Testing Library `render(<Counter />)` | `render(() => <App />, root)` — pass a function so Solid creates the root first |
| `render` onto SSR HTML / `hydrate` into an empty node | `hydrate(() => <App />, root)` when HTML already exists; `render` for an empty mount |
| `renderToString(() => <App />)` for an async or lazy-route tree | `await renderToStream(() => <App />)` (one consumer: `pipe` / `pipeTo` / `readable`). String render emits `<Loading>` fallbacks |
| `clientOnly(() => import("./Map"))` for a rarely shown widget | same + `{ lazy: true }` so the import waits until first render (default starts at declaration) |
| `<NoHydration><Chart /></NoHydration>` to skip SSR of a widget | `clientOnly(() => import("./Chart"))` — `NoHydration`/`Hydration` split ownership, they do not choose visible content |
| `await flush()` / `flush()` to wait on a pending memo | `await resolve(() => value())` (or Testing Library async queries); `flush()` only drains staged *sync* writes |
| `action(function* () { setX(v); })` around a navigation-shaped setter | plain setter; async computeds hold previous values. Core `action` only when writes happen *after* async work |
| `createContext` + a root provider for a true app singleton | module-level signal/store (SSR: shared across requests). Context is subtree scoping |
| `import { GET } from "@solidjs/start"` / `createAsync` / `useSubmission` / `<FileRoutes />` / `"use client"` | `GET` from `@solidjs/web/server-functions`; `createMemo(() => getUser(id()))`; `useSubmissions`; `fileRoutes(pageRoutes)`; Solid has no `"use client"` |
| `<Show keyed when={user()}>` by default | default `Show` (keeps children mounted); `keyed` only when internal state must reset |
| overlapping truthy `<Match>`es all expected to render | first truthy `<Match>` wins; later matches are skipped |
| missing `<HydrationScript />` / one script for many roots | once, before app markup, when the app owns the document; distinct `renderId` per extra root |
| `Router.paths` as the current URL; calling `preload()` and using the return as props | `useLocation` / `useParams`; factory/route `preload` result is `props.data` |
| `query.get(key)` with no guaranteed entry; `query.set(key, promise)` | `query.get` throws if missing; `query.set` does not accept a promise |
| `onCleanup(() => ...)` in a component body | `onSettled(() => { ...; return cleanup })` — `onCleanup` is for custom primitives |
| `onSettled` with reactive reads expecting re-runs | each call is a **single** fire; reads are untracked. Ongoing work is `createEffect` |
| `<Router>` nested inside `<Router>` | one instance; nest `children` arrays (or a lazy children thunk) |
| `const View = tab() ? A : B; return <View />` | `const View = dynamic(() => (tab() ? A : B))` — the ternary at setup freezes the choice |
| `<For each={resolved()}>` after `children()` | `{resolved.toArray()}` — resolved children are not a reactive data list |
| `<input onChange={...}>` for keystrokes | `onInput` — native `onChange` is blur/commit |
| `createOptimistic` for a local edit draft | writable derivation / plain store. Optimistic is for an in-flight mutation |
| `createMemo(async fn, { loadingValue })` / `{ seedLoadingValue: true }` as the default first-flight UI | `<Loading>` for first flight; those options are escape hatches (store projections use `seedLoadingValue`) |
| `setSubmitted(true)` + an effect that watches it | do the work in the handler or an `action` |
| `findUser(userId)` with the id from the client as identity | `getRequestEvent()!.locals.userId` |
| `action={"/_server/" + id}` in app JSX | `action={createTodo.url}` or a router `action` |
| `<form method="get" action={update.url}>` for a mutation | GET forms only for idempotent search; mutations are POST |
| `window.location.href = ...` / `history.pushState` | `useNavigate()` or `<a href={Router.paths...}>` |
| `httpStatus(404)` in a click handler | call it bare in the component / error-fallback body (a scope declaration, not a mutation) |
| `try { user() } catch (e) { /* NotReadyError */ }` | `<Loading>` — app code should not catch `NotReadyError` |
| `{latest(() => results())}` as the visible list | settled read + `isPending()` for the indicator; `latest` is for previews |
| `typeof window !== "undefined"` | `isServer` / `isDev` from `@solidjs/web` |
| `Object.assign({}, props)` / expecting `merge` to skip `undefined` like 1.x `mergeProps` | `omit` / `merge` — explicit `undefined` **overrides** (Object.assign) |
| `isPending(user())` / `latest(user())` | `isPending(user)` / `latest(user)` — pass the accessor (or `() => user()`). Calling it first evaluates the read before the helper runs |
| `isPending(...)` as the first-load spinner | `<Loading>` owns first flight; `isPending` is the *refetch* indicator after a settled answer exists |
| `refresh(getUser.key)` / `revalidate(user)` / `return refresh()` from `"use server"` | three APIs: core `refresh(source)` reruns a reactive source; router `revalidate(getUser.key)` invalidates the query cache; `return reload({ revalidate: "todos" })` asks the integration to refresh cached data |
| `revalidate(liveSource)` | `live()` updates through the open stream; do not revalidate it |
| `refresh(user)` without `affects` when the reload should look pending | pair `affects(user)` with `refresh(user)` — a bare `refresh` re-asks quietly |
| `<Dynamic component={tab() ? A : B} />` | `const View = dynamic(() => (tab() ? A : B))` — `<Dynamic>` is a JSX convenience; app code should use `dynamic()` for stable identity |
| `<meta name="description" content="...">` hardcoded in the document shell | `<Meta>` from `@solidjs/meta`. A static `<title>` is the fallback; other hardcoded tags coexist with the registry |
| `useHead({ tag: "meta", ... })` for ordinary page tags | `<Title>` / `<Meta>` / `<Script>` (JSON-LD). `useHead` is the lower-level registry |
| two `<Meta property="og:image">` meant as one replacement set | wrap them in `<Head>` — a later group replaces the earlier set as one unit |
| `createRoot(() => ...)` inside a component | let `render` / the component owner own the scope. `createRoot` is for tests, libraries, and non-render entry points |
| `JSON.stringify(store)` / `structuredClone(store)` | `snapshot(store)` — proxies throw or leak reactivity |
| `import { env } from "virtual:env/client"` (or `import.meta.env`) for a signing secret | `import { env } from "virtual:env/server"` — client map values are public |
| `renderToStream(...).pipe(res)` and also `.readable` / `await` on the same result | exactly one consumer: `pipe` / `pipeTo` / `readable` / await |
| `return Response.json(user, { status: 201 })` from `"use server"` | `return respond(user, { status: 201 })` — scripted callers receive `user`, not a `Response` |
| `<Portal>{user().name}</Portal>` for an async read | hoist the read above the portal (children start on the client); async UI inside one wants its own `<Loading>` |
| a client history adapter to pick the SSR location | `<Router url={request.url}>` (or the request event). Client adapters do not select the server URL |
| `fetch('/api')` at component-body top level | `createMemo(async () => { ... fetch ... })` under `<Loading>` — a top-level fetch runs once at mount and is not a reactive source |
| `<input type="checkbox" value={on()} />` | `checked={on()}` for the toggle; `value="string"` only when grouping radios or listing submitted values |
| `createMemo(() => { void save(); return x(); })` / an effect that calls an action | invoke actions from handlers, not from memos or effects |
| `createSignal(props.value)` / `createStore(props.items)` | `createSignal(() => props.value)` / `createStore(() => props.items, fallback)` — a bare `props.x` at setup is a snapshot |
| `createRenderEffect` / `createTrackedEffect` as the default effect | two-phase `createEffect(compute, apply)` |
| `createEffect(() => source(), () => setError(null))` to reset a signal | `createSignal(() => { source(); return null; })` — the writable derivation resets on change; a sole-setter apply is rule 4 |
| a "server-safe" initial value adopted after mount (React hydration-mismatch fix) | client mode mounts with `render()` into an empty body — no hydration, no mismatch; read `localStorage` / `matchMedia` directly at signal creation |

```tsx
// WRONG — post-await read never subscribes; production can hang pending
const user = createMemo(async () => {
  const response = await fetch('/api/me');
  const extra = flag(); // too late
  return { ...(await response.json()), extra };
});

// CORRECT
const user = createMemo(async () => {
  const extra = flag();
  const response = await fetch('/api/me');
  return { ...(await response.json()), extra };
});
```

```tsx
// WRONG — rest is a plain object snapshot
function Field(props: { label: string; class?: string }) {
  const rest = { ...props };
  return <label>{props.label}<input {...rest} /></label>;
}

// CORRECT
function Field(props: { label: string; class?: string }) {
  const rest = omit(props, 'label');
  return <label>{props.label}<input {...rest} /></label>;
}
```

```tsx
// WRONG — user() throws not-ready at Page; child's <Loading> never sees it
function Page() {
  const user = createMemo(async () => (await fetch('/api/me')).json());
  return <Profile user={user()} />;
}

// CORRECT — pass the accessor; read it under the boundary that owns the fallback
function Profile(props: { user: Accessor<User> }) {
  return (
    <Loading fallback={<p>Loading…</p>}>
      <h1>{props.user().name}</h1>
    </Loading>
  );
}
function Page() {
  const user = createMemo(async () => (await fetch('/api/me')).json());
  return <Profile user={user} />;
}
```

```tsx
// WRONG — two different `action`s; the core one is not a form URL
import { action } from 'solid-js';
const save = action(async function* (form: FormData) {
  yield persist(form);
});
<form onSubmit={(e) => { e.preventDefault(); void save(new FormData(e.currentTarget)); }}>
  <button type="submit">Save</button>
</form>

// CORRECT — router action is POST-addressable (only if `@solidjs/router` is in the project)
import { action } from '@solidjs/router';
const save = action(async (form: FormData) => persist(form), 'save');
<form action={save} method="post">
  <button type="submit">Save</button>
</form>
```

```tsx
// WRONG — evaluating JSX before the root exists
import { render } from '@solidjs/web';
render(<App />, document.getElementById('app')!);

// CORRECT
render(() => <App />, document.getElementById('app')!);
```

```tsx
// WRONG — user() runs before isPending, so the helper never sees the accessor
<article aria-busy={isPending(user())}>{user().name}</article>

// CORRECT — pass the accessor (or () => user()); <Loading> still owns first flight
<Loading fallback={<p>Loading…</p>}>
  <article aria-busy={isPending(user) ? 'true' : 'false'}>{user().name}</article>
</Loading>
```

```tsx
// WRONG — tab() is read once at setup; View never changes
const View = tab() ? Detailed : Compact;
return <View value="now" />;

// CORRECT
const View = dynamic(() => (tab() ? Detailed : Compact));
return <View value="now" />;
```

## Checking the official docs

Solid 2.0 docs: https://v2.solidjs.com/ — the site blocks non-browser fetchers, so from an
agent use the mirror, which serves every page as plain markdown:

- Index of all pages: `https://v2-rebuild--solid-docs-v2.netlify.app/llms.txt`
- Single-file corpus: `https://v2-rebuild--solid-docs-v2.netlify.app/llms-full.txt`
- Any page: append `.md`, e.g. `https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/reactivity/create-signal.md`

A curated URL list is in [references/official-docs.md](references/official-docs.md).

**Never** consult Solid 1.x sources (docs.solidjs.com, pre-2.0 tutorials, old Stack Overflow).
Solid 2.0 is a breaking rewrite; 1.x answers are wrong here. The banned-API table is in the
always-applied rules installed alongside this skill.

## Review checklist (before finishing any TSX change)

- [ ] No props destructuring; no `props.` at component-body top level.
- [ ] Every reactive read (`signal()`, `props.x`, `store.x`) sits in JSX, a memo, an effect
      compute, or a boundary — not the component body.
- [ ] No signal-synced-by-effect; derived values are functions or memos. Reset-on-change
      is a writable derivation (`createSignal(() => { source(); return initial; })`), not
      an effect calling the setter.
- [ ] Event handlers wrap setters (`onClick={() => setX(...)}`), use `currentTarget`,
      and `onInput` for keystrokes. `innerHTML` is sanitized and not mixed with children.
- [ ] Async memos are passed as accessors (`user={user}`), not `user={user()}`, so
      `<Loading>` around the *read* can catch not-ready.
- [ ] Lists via `<For>` (server/refetched rows keyed by stable id), conditionals via
      ternary/`<Show>`; no `{list().map(...)}` in JSX; no `key` props; no `value()!`.
- [ ] Effects are two-phase and only at imperative boundaries; apply does not read stores.
- [ ] Async reads sit under `<Loading>` (the data slot, not chrome); errors under `<Errored>`.
      Reactive inputs of an async memo are read before the first `await`. No hand-rolled
      `loading`/`error` signals or `=== undefined` readiness branches. First load is
      `<Loading>`; refetch indicator is `isPending(user)` (the accessor, not `user()`).
      Core `refresh(source)`, router `revalidate(key)`, and `return reload(...)` are
      different APIs — do not mix them.
- [ ] External collections reconcile into stores (function-form `createStore` /
      `reconcile`), never wholesale draft assignment or `setTodos((t) => t.filter(...))`
      as the identity-preserving update.
- [ ] Rest props via `omit`, not `{ ...props }`. Conditional `class` via objects, not string concat.
- [ ] Input filters write back to the DOM on reject (inputs do not rewind).
- [ ] No Solid 1.x imports or APIs (`solid-js/store`, `createResource`, `onMount`, `Suspense`, ...).
      No `JSX` imported from `solid-js` — children/return types are `Element` from
      `solid-js`; DOM `JSX` types come from `@solidjs/web`.
- [ ] Inspect children with `children()`; code-split with `lazy` + `<Loading>`; reactive
      component choice with `dynamic()`. No `React.lazy`, no effects inside ref callbacks.
- [ ] Browser-only code uses `isServer` / `clientOnly`, not `typeof window`.
      Component teardown is `onSettled` (return cleanup), not `onCleanup`.
- [ ] If the project has a router: `createRouter({ routes })`, not JSX `<Route>` / `<A>`.
      One instance, no nested `<Router>`. Navigate with `useNavigate` / `<a href>`, not
      `window.location`. Router `action`/`query` come from `@solidjs/router` (POST forms + cache), not
      core `action`/`refresh`. Forms: `<form action={save} method="post">`.
- [ ] `render(() => <App />, root)` — a function, not `render(<App />)`. `hydrate` when
      HTML already exists. Stream async/lazy trees (`await renderToStream(...)`) with
      exactly one consumer (`pipe` / `pipeTo` / `readable`). Snapshot stores with
      `snapshot(store)`, not `JSON.stringify`. Secrets live in `virtual:env/server`.
- [ ] `jsxImportSource` is `@solidjs/web`; Vite plugin is `@solidjs/vite-plugin`.
      No `@solidjs/start`, `vinxi`, `"use client"`, or Next.js imports.
- [ ] Single return per component; no early returns on reactive conditions.
- [ ] `solid2-kit check` and the project's typecheck pass; `solid2-kit doctor` too if
      `package.json`, tsconfig, or root config files changed.
