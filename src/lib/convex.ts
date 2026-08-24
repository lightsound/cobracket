import { ConvexClient } from 'convex/browser';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import { createMemo, onCleanup } from 'solid-js';
import type { Accessor } from 'solid-js';

export function getConvexUrl(): string | undefined {
  const url = import.meta.env.VITE_CONVEX_URL;
  return typeof url === 'string' && url.length > 0 ? url : undefined;
}

let client: ConvexClient | undefined;

export function getConvexClient(): ConvexClient | undefined {
  if (typeof window === 'undefined') return undefined;
  const url = getConvexUrl();
  if (!url) return undefined;
  client ??= new ConvexClient(url);
  return client;
}

/**
 * Bridges a Convex subscription into Solid's async model. The returned
 * accessor suspends to the nearest `<Loading>` boundary until the first
 * result arrives, updates the settled value on every later push, and throws
 * subscription errors into the reactive graph for `<Errored>` to catch.
 *
 * Call from a component body: the subscription is tied to the caller's
 * owner via `onCleanup`. Without a configured client (missing
 * `VITE_CONVEX_URL` or during SSR) the accessor stays pending forever, so
 * callers should gate on `getConvexUrl()` before rendering reads.
 */
export function createConvexQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  args: FunctionArgs<Query>,
): Accessor<FunctionReturnType<Query>> {
  type Result = FunctionReturnType<Query>;
  const queue: Result[] = [];
  let failure: unknown;
  let wake = () => {};

  const convex = getConvexClient();
  if (convex) {
    onCleanup(
      convex.onUpdate(
        query,
        args,
        (result) => {
          queue.push(result);
          wake();
        },
        (error) => {
          failure = error;
          wake();
        },
      ),
    );
  }

  return createMemo(() =>
    (async function* () {
      while (true) {
        if (failure !== undefined) throw failure;
        if (queue.length > 0) {
          yield queue.shift() as Result;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    })(),
  );
}
