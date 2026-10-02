import { isServer } from "@solidjs/web";
import { ConvexClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { createMemo, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";

/**
 * @public
 */
export function getConvexUrl(): string | undefined {
  const url = import.meta.env.VITE_CONVEX_URL;
  return typeof url === "string" && url.length > 0 ? url : undefined;
}

let client: ConvexClient | undefined;

/**
 * @public
 */
export function getConvexClient(): ConvexClient | undefined {
  if (isServer) return undefined;
  const url = getConvexUrl();
  if (!url) return undefined;
  client ??= new ConvexClient(url);
  return client;
}

/**
 * Run a Convex mutation on the shared client. Callers sit behind the
 * `getConvexUrl()` render gate, so a missing client here is a programming
 * error, not a state to branch on — it throws into the caller's error
 * handling like any other mutation failure.
 *
 * @public
 */
export async function runMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
  args: FunctionArgs<Mutation>,
): Promise<FunctionReturnType<Mutation>> {
  const convex = getConvexClient();
  if (!convex) throw new Error("Convex client is not configured");
  return await convex.mutation(mutation, args);
}

/**
 * How long a prefetched subscription is held open, so the page it was started
 * for finds the result in the client when it subscribes. Hover-to-click is
 * well under a second; the margin is for a link hovered and then clicked a
 * while later, and costs one idle subscription per prefetch until it expires.
 */
const PREFETCH_HOLD_MS = 10_000;

/**
 * Start a query's subscription ahead of the page that will read it, so that
 * page's `createConvexQuery` finds the answer already in the client.
 *
 * The Convex client keeps one subscription per query-and-args and delivers
 * its current value to every new subscriber, so "preloading" here is simply
 * subscribing early and holding the subscription open for a grace period.
 * Nothing is cached outside the client: when the hold expires (or the query
 * fails, which releases it at once so no error lingers for the page to
 * inherit) the subscription ends like any other, and the page's own is the
 * only one left. Meant for route `preload`s on link intent; a page that
 * subscribes a round trip after a hover then shows no fallback at all.
 *
 * @public
 */
export function prefetchConvexQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query>,
): void {
  const convex = getConvexClient();
  if (!convex) return;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    subscription.unsubscribe();
  };
  const subscription = convex.onUpdate(
    query,
    args,
    () => {},
    () => release(),
  );
  const timer = setTimeout(release, PREFETCH_HOLD_MS);
}

/**
 * Bridges a Convex subscription into Solid's async model.
 *
 * - Reads suspend to the nearest `<Loading>` until the first result arrives;
 *   subscription errors are thrown into the reactive graph for `<Errored>`.
 * - `args` may be an accessor: changing args re-subscribes (the committed
 *   view stays visible and `isPending` reports the in-flight change).
 * - `<Errored>`'s `reset()` and `refresh(query)` re-run the computation: a
 *   fresh subscription starts with a cleared failure and Convex re-emits the
 *   current result, so retries actually recover.
 * - Results are snapshots, so pending deliveries are conflated to the latest.
 *
 * The subscription lives inside the computation: it is disposed when args
 * change, on retry, and when the owning component unmounts. Without a
 * configured client (missing `VITE_CONVEX_URL`, or SSR) the accessor stays
 * pending forever; callers gate on `getConvexUrl()` before rendering reads.
 *
 * @public
 */
export function createConvexQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | Accessor<FunctionArgs<Query>>,
): Accessor<FunctionReturnType<Query>> {
  type Result = FunctionReturnType<Query>;
  const readArgs =
    typeof args === "function" ? (args as Accessor<FunctionArgs<Query>>) : () => args;

  // Named by the Convex function it subscribes to, so attribution's cost and
  // hold tables identify which query a row belongs to. Every subscription
  // would otherwise share the anonymous `computed` label.
  return createMemo(
    () => {
      // Inside the computation, not at creation: a memo is lazy, so a query
      // created by a provider nothing reads (a test mounting `AppProviders`
      // around a component that never touches the backend) never constructs
      // a client, let alone a websocket. The client itself is created once
      // and shared, so resolving it per run costs nothing.
      const convex = getConvexClient();
      // Reading reactive args here makes them a dependency of the computation.
      const resolvedArgs = readArgs();

      let current: Result | undefined;
      let version = 0;
      let failure: unknown;
      let disposed = false;
      let wake = () => {};

      if (convex) {
        const unsubscribe = convex.onUpdate(
          query,
          resolvedArgs,
          (result) => {
            current = result;
            version += 1;
            failure = undefined;
            wake();
          },
          (error) => {
            failure = error;
            wake();
          },
        );
        onCleanup(() => {
          disposed = true;
          unsubscribe();
          wake();
        });
      }

      return (async function* () {
        let seen = 0;
        while (!disposed) {
          if (failure !== undefined) throw failure;
          if (version > seen) {
            seen = version;
            yield current as Result;
            continue;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      })();
    },
    { name: `query:${getFunctionName(query)}` },
  );
}
