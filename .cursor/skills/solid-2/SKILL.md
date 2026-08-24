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
(replacements for Solid 1.x `mergeProps` / `splitProps`).

### Store updates (draft mutation)

```tsx
import { createStore } from 'solid-js';

const [profile, setProfile] = createStore({ name: 'Ada', role: 'Engineer' });

setProfile((draft) => {
  draft.name = 'Grace'; // only readers of .name re-run
});
```

Reconcile server data into a store (given `const [state, setState] = createStore({ todos: [] })`):
`setState((draft) => { reconcile(serverTodos, 'id')(draft.todos); })`.
Plain non-reactive copy for logging/serialization: `snapshot(store)`.
Subscribe an effect compute to every nested change: `deep(store)`.

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
(e.g. `() => ({ name: user.name, role: user.role })`). Compute-phase errors can be
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
  where the memo was created. Boundary placement is purely a UX decision — it does not
  change when fetches start (no waterfalls: nested components set up and fetch in parallel).
- `<Errored>` function fallbacks receive an error **accessor**: call `error()`.
- Refetch: `refresh(results)`. In-flight indicator: `isPending(() => results())`.
  Freshest in-flight value for imperative code: `latest(results)`.
- Coordinate reveal order of sibling `<Loading>` boundaries with `<Reveal order="sequential" | "together" | "natural">`.

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
import type { Ref } from 'solid-js';

function SearchField(props: { ref?: Ref<HTMLInputElement> }) {
  let input!: HTMLInputElement;
  return (
    <>
      <input ref={[props.ref, (el) => (input = el)]} type="search" />
      <button onClick={() => input.select()}>Select</button>
    </>
  );
}
```

Ref arrays flatten recursively; each callback runs in order. No `forwardRef` needed.

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
- [ ] `class` / CSS-name `style` / `onInput` — no `className`, `backgroundColor`, per-keystroke `onChange`.
- [ ] Lists via `<For>` (server/refetched rows keyed by stable id), conditionals via
      ternary/`<Show>`; no `key` props; no `value()!` hand-narrowing.
- [ ] Effects are two-phase and only at imperative boundaries.
- [ ] Async reads sit under `<Loading>`; errors under `<Errored>`.
- [ ] No Solid 1.x imports or APIs (`solid-js/store`, `createResource`, `onMount`, `Suspense`, ...).
- [ ] Single return per component; no early returns on reactive conditions.
- [ ] `solid2-kit check` and the project's typecheck pass.
