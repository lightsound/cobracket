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
| Pick a component/tag from reactive state | `dynamic(() => ...)` from `@solidjs/web` (stable identity) |
| Browser-only widget (charts, maps, `window`) | `clientOnly(() => import("./Chart"))` from `@solidjs/web` |
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
treat resolved children as a reactive data list for `<For>`:

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
variable in JSX. `<Dynamic>` is the JSX spelling of the same primitive.

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
  boundary keeps settled content during refetch; `isPending(() => results())` is the
  indicator. Use `on={query()}` (the **value**, not the accessor `on={query}`) only when
  that identity should put the fallback back on screen.
- Read every reactive input **before the first `await`** in an async computation. A read
  after `await` does not subscribe; production can sit pending with no retry.
- `<Errored>` function fallbacks receive an error **accessor** and a `reset` callback:
  `fallback={(error, reset) => ...}`.
- Refetch: `refresh(results)`. In-flight indicator: `isPending(() => results())`.
  Freshest in-flight value for imperative code: `latest(results)`.
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
  // Component-owned setup: unsubscribe is tied to the caller's owner.
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

**`yield`, not a bare `await`, is the transaction boundary.** `await api.save()` then
`setTodos(...)` *runs*, but the write commits immediately and optimistic rollback is lost.
Either `yield saveTodo(todo)` or, when you need a typed result, `const saved = await api.save(); yield; setTodos(...)`.

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
`<Switch>` / `<Match>`.

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
fine-grained updates flow through the signals inside it.

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
Run tests in dev mode first — Solid 2 emits diagnostics for top-level reactive reads,
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

Import DOM `JSX` types from `@solidjs/web`; renderer-neutral `Component` /
`ParentProps` from `solid-js`. Vite: `import solid from "@solidjs/vite-plugin"`
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
on the route objects, not nested `<Route>` / nested routers. Navigate with
plain `<a href={Router.paths.about}>` (or `useNavigate`); there is no `<A>` /
`<Navigate>` / `<HashRouter>`. Session location is `useLocation` / `useParams`,
not `Router.paths`. One router per app.

### Server functions — `"use server"`

```ts
export async function findUser(id: string) {
  'use server';
  // validate `id`; read identity from getRequestEvent(), never from arguments
  return database.users.find(id);
}
```

A function-level server function cannot close over component locals — pass
values as arguments. Treat every argument as untrusted. During SSR the same
reference runs in-process; in the browser it is HTTP. Mutations that should
revalidate: `redirect` / `reload` from `@solidjs/web` (see the server-function
guides). For 404 during SSR: `httpStatus(404)` from `@solidjs/web`.
`throw new Error("…")` is stripped to `"Internal Server Error"` in production —
use `markSafeError` or `respond(..., { status })` for intentional client-facing
failures. `GET()` is only for idempotent reads (URLs leak into logs/history).
`live()` yields **current state** (each yield replaces the last); do not treat
it as an append-only event log, and hoist the memo so consumers share one
connection.

### Document head — no MetaProvider

```tsx
import { Title, Link, Meta } from '@solidjs/meta';

<Title>Page title</Title>
<Meta name="description" content="..." />
```

Solid Meta 1.x has **no provider**. Render tags anywhere; later wins, unmount
restores. `useHead` from `@solidjs/web` is the lower-level registry. Do not
hardcode a second `<title>` in the document shell.

## These still run — write the other form

Official docs (and the compiler) allow several of these. They are the wrong
tool: they snapshot, drop subscriptions, or rebuild work Solid already knows
how to reuse. Prefer the form on the right.

| Compiles / renders | Write this |
|---|---|
| `{todos().map((t) => <Row todo={t} />)}` | `<For each={todos()} keyed={(t) => t.id}>` |
| `<For each={todos().map(t => t)}>` | derive first, then `<For each={visible()}>` |
| `class={`btn ${on() ? "on" : ""}`}` | `class={["btn", { on: on() }]}` |
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
- [ ] No signal-synced-by-effect; derived values are functions or memos.
- [ ] Event handlers wrap setters (`onClick={() => setX(...)}`), use `currentTarget`,
      and `onInput` for keystrokes. `innerHTML` is sanitized and not mixed with children.
- [ ] Async memos are passed as accessors (`user={user}`), not `user={user()}`, so
      `<Loading>` around the *read* can catch not-ready.
- [ ] Lists via `<For>` (server/refetched rows keyed by stable id), conditionals via
      ternary/`<Show>`; no `{list().map(...)}` in JSX; no `key` props; no `value()!`.
- [ ] Effects are two-phase and only at imperative boundaries; apply does not read stores.
- [ ] Async reads sit under `<Loading>` (the data slot, not chrome); errors under `<Errored>`.
      Reactive inputs of an async memo are read before the first `await`. No hand-rolled
      `loading`/`error` signals or `=== undefined` readiness branches; refetch via
      `refresh`, not counter signals.
- [ ] External collections reconcile into stores (function-form `createStore` /
      `reconcile`), never wholesale draft assignment or `setTodos((t) => t.filter(...))`
      as the identity-preserving update.
- [ ] Rest props via `omit`, not `{ ...props }`. Conditional `class` via objects, not string concat.
- [ ] Input filters write back to the DOM on reject (inputs do not rewind).
- [ ] No Solid 1.x imports or APIs (`solid-js/store`, `createResource`, `onMount`, `Suspense`, ...).
- [ ] Inspect children with `children()`; code-split with `lazy` + `<Loading>`; reactive
      component choice with `dynamic()`. No `React.lazy`, no effects inside ref callbacks.
- [ ] Browser-only code uses `isServer` / `clientOnly`, not `typeof window`.
- [ ] If the project has a router: `createRouter({ routes })`, not JSX `<Route>` / `<A>`.
- [ ] `jsxImportSource` is `@solidjs/web`; Vite plugin is `@solidjs/vite-plugin`.
- [ ] Single return per component; no early returns on reactive conditions.
- [ ] `solid2-kit check` and the project's typecheck pass.
