import { isServer } from "@solidjs/web";
import { ConvexClient } from "convex/browser";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";

// The Convex implementation behind the data seam (`./backend`): the
// client singleton, and the subscription / mutation / prefetch
// primitives the seam's dispatch calls. Pages never import this
// module directly — the seam is the only caller, plus `./auth`,
// whose Convex session machinery is wired to this client. When the
// migration's M6 removes Convex, this file goes with it and the seam
// loses nothing but a dispatch branch.

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
 * Subscribe to a query on the shared client, delivering each result
 * and any failure to the callbacks; the returned function ends the
 * subscription. Without a configured client the subscription never
 * delivers — the seam's accessor stays pending, exactly as it did
 * when this bridging lived in the seam itself.
 *
 * @public
 */
export function subscribeConvexQuery(
  query: FunctionReference<"query">,
  args: Record<string, unknown>,
  onValue: (value: unknown) => void,
  deliverError: (error: unknown) => void,
): () => void {
  const convex = getConvexClient();
  if (!convex) return () => {};
  return convex.onUpdate(
    query,
    args as FunctionArgs<typeof query>,
    (result) => onValue(result),
    (error) => deliverError(error),
  );
}

/**
 * Run a Convex mutation on the shared client. Callers sit behind the
 * `getConvexUrl()` render gate, so a missing client here is a
 * programming error, not a state to branch on — it throws into the
 * caller's error handling like any other mutation failure.
 *
 * @public
 */
export async function runConvexMutation<Mutation extends FunctionReference<"mutation">>(
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
 * page's seam accessor finds the answer already in the client.
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
