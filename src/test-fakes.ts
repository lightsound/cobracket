/**
 * A stand-in for the app's data seam, so a page can be mounted under the
 * diagnostics gate without a Convex deployment.
 *
 * Pages reach the backend through exactly two modules — `src/lib/convex.ts`
 * (`getConvexUrl`, `createConvexQuery`, `getConvexClient`, `runMutation`) and
 * `src/lib/auth` — which is what makes this cheap: the narrow module ADR 0004
 * asks for is also the narrow module a test can replace. Everything else in a
 * page runs for real.
 *
 * The fake reproduces the shape that matters to the gate, not just the values.
 * A read whose args it has not seen starts as a promise — including the very
 * first one — so `<Loading>` boundaries engage as they do in production and a
 * re-subscribing read forms a real hold; a later push to a live subscription
 * is a plain value, the way Convex delivers one. Both halves matter: a page
 * tested against synchronous data never forms a hold, and the gate's
 * responsiveness question then has nothing to judge.
 *
 * Wire it from a page test with vitest's module mocks:
 *
 * ```ts
 * vi.mock("../lib/convex", async () => (await import("../test-fakes")).convexModule());
 * vi.mock("../lib/auth", async () => (await import("../test-fakes")).authModule());
 * ```
 *
 * Both the mock factory and the test body import this module, so they share
 * one instance and the test drives the same backend the page reads.
 */
import { beforeEach } from "vite-plus/test";
import { type Accessor, createMemo, createSignal } from "solid-js";
import { getFunctionName } from "convex/server";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id, TableNames } from "../convex/_generated/dataModel";

const FAKE_URL = "https://fake.convex.cloud";

/**
 * A readable stand-in for a Convex id. `publishQuery` is typed against the
 * real `FunctionReturnType`, so a fixture cannot drift from the backend
 * contract — which is the point — and the branded id types are the one part
 * of that contract a test cannot honestly produce.
 *
 * @public
 */
export function fakeId<Table extends TableNames>(value: string): Id<Table> {
  return value as Id<Table>;
}

interface Flight {
  read: Accessor<unknown>;
  deliver: (value: unknown) => void;
  /** Settle a still-pending flight; a no-op once a real delivery has landed. */
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

/** The latest value published per Convex function. */
let published = new Map<string, unknown>();
/** Live subscriptions, by function and then by the args they subscribed with. */
let flights = new Map<string, Map<string, Flight>>();
let mutationHandlers = new Map<string, (args: unknown) => unknown>();
let calls: { name: string; args: unknown }[] = [];
let routes: string[] = [];

/**
 * Subscriptions are keyed by args, not just by function, because that is what
 * `convex.onUpdate` does: changing args tears the subscription down and opens
 * a new one, and the read is pending again until the new answer lands. A fake
 * keyed by function alone would hand an args change an already-settled value,
 * and every hold a page forms by re-subscribing — the shape `latest()` and
 * `isPending()` exist for — would disappear from the test.
 *
 * So a flight for args never seen before starts pending even when the answer
 * is already known, and the value arrives in a later turn.
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
 * Publish a query result, as a subscription push would. Before the first call
 * the query stays pending, which is the state a page's `<Loading>` fallback
 * is for — a legitimate thing to assert, not a setup step to rush past.
 *
 * @public
 */
export function publishQuery<Query extends FunctionReference<"query">>(
  query: Query,
  value: FunctionReturnType<Query>,
): void {
  const name = getFunctionName(query);
  published.set(name, value);
  for (const flight of flights.get(name)?.values() ?? []) flight.deliver(value);
}

/**
 * Answer a mutation. The handler may throw, which is how a page's error path
 * is exercised.
 *
 * @public
 */
export function answerMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
  handler: (args: FunctionArgs<Mutation>) => FunctionReturnType<Mutation>,
): void {
  mutationHandlers.set(getFunctionName(mutation), handler as (args: unknown) => unknown);
}

/**
 * Every mutation the page has run, oldest first, by Convex function name.
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

function fakeCreateConvexQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | Accessor<FunctionArgs<Query>>,
): Accessor<FunctionReturnType<Query>> {
  const name = getFunctionName(query);
  const readArgs = typeof args === "function" ? (args as Accessor<unknown>) : () => args;
  return createMemo(
    () => {
      // The args identify the subscription, so a change opens a new flight —
      // the same thing a real re-subscription does, and the reason a page can
      // form a hold here at all.
      const argsKey = JSON.stringify(readArgs() ?? null);
      return flightFor(name, argsKey).read() as FunctionReturnType<Query>;
    },
    { name: `fake:${name}` },
  );
}

async function fakeRunMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
  args: FunctionArgs<Mutation>,
): Promise<FunctionReturnType<Mutation>> {
  const name = getFunctionName(mutation);
  calls.push({ name, args });
  const handler = mutationHandlers.get(name);
  if (!handler) throw new Error(`No fake answer for mutation ${name}`);
  return handler(args) as FunctionReturnType<Mutation>;
}

/**
 * The replacement for `src/lib/convex.ts`.
 *
 * @public
 */
export function convexModule(): Record<string, unknown> {
  return {
    getConvexUrl: () => FAKE_URL,
    getConvexClient: () => ({ mutation: fakeRunMutation }),
    createConvexQuery: fakeCreateConvexQuery,
    runMutation: fakeRunMutation,
  };
}

/**
 * The replacement for `src/lib/auth`. `createOrganizer` stays a query so the
 * page's session boundary is exercised rather than stubbed away; the two
 * imperative halves become no-ops, since a real `ensureOrganizer` builds an
 * HTTP client and talks to a server.
 *
 * @public
 */
export function authModule(): Record<string, unknown> {
  return {
    initAuth: () => {},
    ensureOrganizer: async () => {},
    createOrganizer: () => fakeCreateConvexQuery(api.auth.currentOrganizer, {}),
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
