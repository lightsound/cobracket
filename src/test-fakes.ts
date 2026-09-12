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
 * The fake reproduces the shape that matters to the gate, not just the values:
 * a query's first read is a promise, so `<Loading>` boundaries engage exactly
 * as they do in production, and a later push is a plain value, the way a
 * subscription delivers one. A page tested against synchronous data would
 * never form a hold and the gate would have nothing to judge.
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

interface Channel {
  read: Accessor<unknown>;
  push: (value: unknown) => void;
}

/**
 * One query's values over time. The first push settles the promise the signal
 * already holds rather than replacing it, so the boundary sees one transition
 * from pending to value — replacing it would abandon a flight the attribution
 * tables would then report.
 */
function createChannel(): Channel {
  let settle: ((value: unknown) => void) | undefined;
  const [value, setValue] = createSignal<unknown>(
    new Promise<unknown>((resolve) => {
      settle = resolve;
    }),
  );
  let settled = false;
  return {
    read: value,
    push(next) {
      if (!settled) {
        settled = true;
        settle?.(next);
        return;
      }
      setValue(() => next);
    },
  };
}

let channels = new Map<string, Channel>();
let mutationHandlers = new Map<string, (args: unknown) => unknown>();
let calls: { name: string; args: unknown }[] = [];

function channelFor(name: string): Channel {
  let channel = channels.get(name);
  if (!channel) {
    channel = createChannel();
    channels.set(name, channel);
  }
  return channel;
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
  channelFor(getFunctionName(query)).push(value);
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

let routes: string[] = [];

function fakeCreateConvexQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | Accessor<FunctionArgs<Query>>,
): Accessor<FunctionReturnType<Query>> {
  const name = getFunctionName(query);
  const readArgs = typeof args === "function" ? (args as Accessor<unknown>) : () => args;
  return createMemo(
    () => {
      // Read the args so a change re-runs the computation, as the real
      // subscription does; the fake keys results by function, not by args.
      readArgs();
      return channelFor(name).read() as FunctionReturnType<Query>;
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
  channels = new Map();
  mutationHandlers = new Map();
  calls = [];
  routes = [];
});
