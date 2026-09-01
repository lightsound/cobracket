import { isServer } from "@solidjs/web";
import { ConvexClient } from "convex/browser";
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
  const convex = getConvexClient();
  const readArgs =
    typeof args === "function" ? (args as Accessor<FunctionArgs<Query>>) : () => args;

  return createMemo(() => {
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
  });
}
