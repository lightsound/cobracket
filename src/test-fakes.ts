/**
 * A stand-in for the app's data seam, so a page can be mounted under the
 * diagnostics gate without a backend.
 *
 * Pages reach the backend through exactly two modules — `src/lib/backend.ts`
 * (`getBackendUrl`, `createBackendQuery`, `runMutation`,
 * `prefetchBackendQuery`) and `src/lib/auth` — which is what makes this
 * cheap: the narrow module ADR 0004 asks for is also the narrow module a
 * test can replace. Everything else in a page runs for real.
 *
 * The fake reproduces the shape that matters to the gate, not just the values.
 * A read whose args it has not seen starts as a promise — including the very
 * first one — so `<Loading>` boundaries engage as they do in production and a
 * re-subscribing read forms a real hold; a later push to a live subscription
 * is a plain value, the way the backends deliver one. Both halves matter: a
 * page tested against synchronous data never forms a hold, and the gate's
 * responsiveness question then has nothing to judge.
 *
 * Wire it from a page test with vitest's module mocks:
 *
 * ```ts
 * vi.mock("../lib/backend", async () => (await import("../test-fakes")).backendModule());
 * vi.mock("../lib/auth", async () => (await import("../test-fakes")).authModule());
 * ```
 *
 * Both the mock factory and the test body import this module, so they share
 * one instance and the test drives the same backend the page reads.
 */
import { beforeEach } from "vite-plus/test";
import { type Accessor, createMemo, createSignal } from "solid-js";
import type { ReadOp, WriteOp } from "./lib/operations";
import { api } from "./lib/operations";

const FAKE_URL = "https://fake.backend.invalid";

interface Flight {
  read: Accessor<unknown>;
  deliver: (value: unknown) => void;
  /**
   * Settle a still-pending flight; a no-op once a real delivery has landed.
   *
   * Only the seeding path uses this, and only to avoid writing a value a
   * `publishQuery` has already settled the flight with. No test can observe
   * the difference — `deliver` would write the same value a second time —
   * and the assertion that would, `expectNoWaste`, is unusable as a gate
   * here: the re-delivery tests push identical data on purpose, so six of
   * them recompute to unchanged values by design (7 to 81 wasted re-runs,
   * measured). So this is defence in a harness whose whole subject is
   * spurious reactive work, not behaviour under test — worth knowing before
   * anyone deletes it for want of a failing test.
   */
  seed: (value: unknown) => void;
}

/**
 * One subscription's values over time. The first delivery settles the promise
 * the signal already holds rather than replacing it, so the boundary sees one
 * transition from pending to value — replacing it would abandon a flight the
 * attribution tables would then report.
 */
function createFlight(): Flight {
  let settle: ((value: unknown) => void) | undefined;
  const [value, setValue] = createSignal<unknown>(
    new Promise<unknown>((resolve) => {
      settle = resolve;
    }),
  );
  let settled = false;
  return {
    read: value,
    deliver(next) {
      if (!settled) {
        settled = true;
        settle?.(next);
        return;
      }
      setValue(() => next);
    },
    seed(next) {
      if (settled) return;
      settled = true;
      settle?.(next);
    },
  };
}

/** The latest value published per operation. */
let published = new Map<string, unknown>();
/** Live subscriptions, by operation and then by the args they subscribed with. */
let flights = new Map<string, Map<string, Flight>>();
let mutationHandlers = new Map<string, (args: unknown) => unknown>();
let calls: { name: string; args: unknown }[] = [];
let routes: string[] = [];

/**
 * Subscriptions are keyed by args, not just by operation, because that is
 * what a real subscription does: changing args tears the subscription down
 * and opens a new one, and the read is pending again until the new answer
 * lands. A fake keyed by operation alone would hand an args change an
 * already-settled value, and every hold a page forms by re-subscribing —
 * the shape `latest()` and `isPending()` exist for — would disappear from
 * the test.
 *
 * So a flight for args never seen before starts pending even when the
 * answer is already known, and the value arrives in a later turn.
 */
function flightFor(name: string, argsKey: string): Flight {
  let byArgs = flights.get(name);
  if (!byArgs) {
    byArgs = new Map();
    flights.set(name, byArgs);
  }
  const existing = byArgs.get(argsKey);
  if (existing) return existing;

  const flight = createFlight();
  byArgs.set(argsKey, flight);
  // Read `published` when the turn arrives, not when the flight opens, and
  // seed rather than deliver: the flight is already registered, so a
  // `publishQuery` in between settles it with the newer answer, and a
  // captured snapshot delivered afterwards would overwrite that with the
  // older one.
  queueMicrotask(() => {
    if (published.has(name)) flight.seed(published.get(name));
  });
  return flight;
}

/**
 * Publish a query result, as a subscription push would. `publishQuery` is
 * typed against the operation descriptor (whose Args/Result are derived
 * from the generated backend reference at compile time), so a fixture
 * cannot drift from the backend contract — which is the point. Before the first call the
 * query stays pending, which is the state a page's `<Loading>` fallback
 * is for — a legitimate thing to assert, not a setup step to rush past.
 *
 * @public
 */
export function publishQuery<Args, Result>(op: ReadOp<Args, Result>, value: NoInfer<Result>): void {
  published.set(op.name, value);
  for (const flight of flights.get(op.name)?.values() ?? []) flight.deliver(value);
}

/**
 * Answer a mutation. The handler may throw, which is how a page's error
 * path is exercised.
 *
 * @public
 */
export function answerMutation<Args, Result>(
  op: WriteOp<Args, Result>,
  handler: (args: NoInfer<Args>) => NoInfer<Result>,
): void {
  mutationHandlers.set(op.name, handler as (args: unknown) => unknown);
}

/**
 * Every mutation the page has run, oldest first, by operation name.
 *
 * @public
 */
export function mutationCalls(): { name: string; args: unknown }[] {
  return calls;
}

/** Where `useNavigate()` was asked to go, oldest first. @public */
export function navigations(): string[] {
  return routes;
}

function fakeCreateBackendQuery<Args, Result>(
  op: ReadOp<Args, Result>,
  args: Args | Accessor<Args>,
): Accessor<Result> {
  const readArgs = typeof args === "function" ? (args as Accessor<unknown>) : () => args;
  return createMemo(
    () => {
      // The args identify the subscription, so a change opens a new flight —
      // the same thing a real re-subscription does, and the reason a page can
      // form a hold here at all.
      const argsKey = JSON.stringify(readArgs() ?? null);
      return flightFor(op.name, argsKey).read() as Result;
    },
    { name: `fake:${op.name}` },
  );
}

async function fakeRunMutation<Args, Result>(
  op: WriteOp<Args, Result>,
  args: Args,
): Promise<Result> {
  calls.push({ name: op.name, args });
  const handler = mutationHandlers.get(op.name);
  if (!handler) throw new Error(`No fake answer for mutation ${op.name}`);
  return handler(args) as Result;
}

/**
 * The replacement for `src/lib/backend.ts`.
 *
 * @public
 */
export function backendModule(): Record<string, unknown> {
  return {
    getBackendUrl: () => FAKE_URL,
    createBackendQuery: fakeCreateBackendQuery,
    // A preload is an early subscription the page then finds already held;
    // the fake's flights are keyed per read already, so there is nothing to
    // warm and nothing to assert — the router's preloads are a no-op here.
    prefetchBackendQuery: () => {},
    runMutation: fakeRunMutation,
  };
}

/**
 * The replacement for `src/lib/auth`. `createOrganizer` stays a query so the
 * page's session boundary is exercised rather than stubbed away; the two
 * imperative halves become no-ops, since a real `ensureOrganizer` talks to
 * a server.
 *
 * @public
 */
export function authModule(): Record<string, unknown> {
  return {
    initAuth: () => {},
    ensureOrganizer: async () => {},
    createOrganizer: () => fakeCreateBackendQuery(api.auth.currentOrganizer, {}),
  };
}

/**
 * The replacement for the two `@solidjs/router` hooks a page uses. Pass the
 * params the route would have matched; navigations are recorded.
 *
 * Targets are stringified because `Router.paths.t(id)` is a path *node*, not
 * a string — the Solid Router 2 shape this app navigates with — and a test
 * asserting where the page went means the URL.
 *
 * @public
 */
export function routerHooks(params: Record<string, string>): Record<string, unknown> {
  return {
    useParams: () => params,
    useNavigate: () => (to: unknown) => {
      routes.push(String(to));
    },
  };
}

// Registered here rather than left to each file: shared module state that a
// test can forget to reset is the same hazard as a gate a test can forget to
// apply.
beforeEach(() => {
  published = new Map();
  flights = new Map();
  mutationHandlers = new Map();
  calls = [];
  routes = [];
});
