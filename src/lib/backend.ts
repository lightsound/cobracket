import { createMemo, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { ReadOp, WriteOp } from "./operations";
import {
  getConvexUrl,
  prefetchConvexQuery,
  runConvexMutation,
  subscribeConvexQuery,
} from "./convex";

// The app's data seam (ADR 0004), widened for the SpacetimeDB migration
// (plan §2.5): pages reach the backend only through this module —
// `createBackendQuery`, `runMutation`, `prefetchBackendQuery`, and
// `getBackendUrl`, driven by the operation descriptors in
// `./operations`. Two implementations will sit behind it: `./convex`
// (today's, the production default) and the SpacetimeDB adapter (the
// migration's target), selected by a build-time env var —
// `VITE_BACKEND=spacetimedb` will pick the adapter; anything else,
// including unset, keeps Convex. Until the adapter lands, the
// dispatch below returns the Convex implementation unconditionally.
// Both remain runnable until the M5 cutover.

// ---------------------------------------------------------------------------
// The implementations behind the seam
// ---------------------------------------------------------------------------

type Unsubscribe = () => void;

/**
 * What an implementation provides: a way to subscribe a read (values
 * and failures delivered to the callbacks; the subscription may start
 * asynchronously — the SpacetimeDB connection is built on first use),
 * a way to run a write, and a way to warm a read ahead of its page.
 * Internal to this package: the seam is the only caller.
 */
interface BackendImpl {
  subscribe<Args, Result>(
    op: ReadOp<Args, Result>,
    args: Args,
    onValue: (value: Result) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe | Promise<Unsubscribe>;
  write<Args, Result>(op: WriteOp<Args, Result>, args: Args): Promise<Result>;
  prefetch<Args>(op: ReadOp<Args, unknown>, args: Args): void;
}

const convexImpl: BackendImpl = {
  subscribe(op, args, onValue, onError) {
    return subscribeConvexQuery(
      op.convex,
      args as Record<string, unknown>,
      onValue as (value: unknown) => void,
      onError,
    );
  },
  async write(op, args) {
    return await runConvexMutation(op.convex, args as never);
  },
  prefetch(op, args) {
    prefetchConvexQuery(op.convex, args as Record<string, unknown>);
  },
};

function getImpl(): BackendImpl {
  // The SpacetimeDB adapter joins this dispatch in the migration's
  // M3 adapter PR; until then the Convex implementation is the only
  // one registered, whatever a build's env says.
  return convexImpl;
}

/**
 * The configured backend's URL, or undefined when this build has no
 * backend to talk to (no `VITE_CONVEX_URL` on the Convex side). Pages
 * gate their reads on it and render the setup notice instead — the
 * same contract `getConvexUrl` has always carried.
 *
 * @public
 */
export function getBackendUrl(): string | undefined {
  return getConvexUrl();
}

// ---------------------------------------------------------------------------
// The seam's reactive surface
// ---------------------------------------------------------------------------

/**
 * Bridges a backend subscription into Solid's async model — the
 * contract `createConvexQuery` has always given pages, now stated
 * against the seam:
 *
 * - Reads suspend to the nearest `<Loading>` until the first result
 *   arrives; subscription errors are thrown into the reactive graph
 *   for `<Errored>`.
 * - `args` may be an accessor: changing args re-subscribes (the
 *   committed view stays visible and `isPending` reports the
 *   in-flight change).
 * - `<Errored>`'s `reset()` and `refresh(query)` re-run the
 *   computation: a fresh subscription starts with a cleared failure,
 *   so retries actually recover.
 * - Results are snapshots, so pending deliveries are conflated to
 *   the latest.
 *
 * The subscription lives inside the computation: it is disposed when
 * args change, on retry, and when the owning component unmounts.
 * Without a configured backend the accessor stays pending forever;
 * callers gate on `getBackendUrl()` before rendering reads.
 *
 * @public
 */
export function createBackendQuery<Args, Result>(
  op: ReadOp<Args, Result>,
  args: Args | Accessor<Args>,
): Accessor<Result> {
  const readArgs = typeof args === "function" ? (args as Accessor<Args>) : () => args;

  // Named by the operation it subscribes to, so attribution's cost
  // and hold tables identify which read a row belongs to. Every
  // subscription would otherwise share the anonymous `computed` label.
  return createMemo(
    () => {
      // Inside the computation, not at module scope. A memo's
      // computation runs when the memo is created, not on first read,
      // so a query created by a provider subscribes at once whether or
      // not anything reads it. What keeps a test that mounts
      // `AppProviders` around a component that never touches the
      // backend from opening a connection is `getBackendUrl()`
      // returning undefined there — the implementations resolve their
      // client inside this computation and find none.
      const configured = getBackendUrl();
      const impl = configured === undefined ? undefined : getImpl();
      // Reading reactive args here makes them a dependency of the
      // computation.
      const resolvedArgs = readArgs();

      let current: Result | undefined;
      let version = 0;
      let failure: unknown;
      let disposed = false;
      let wake = () => {};

      if (impl) {
        let unsubscribe: Unsubscribe | undefined;
        const started = impl.subscribe(
          op,
          resolvedArgs,
          (result) => {
            current = result;
            version += 1;
            failure = undefined;
            wake();
          },
          (error) => {
            if (disposed) return;
            failure = error;
            wake();
          },
        );
        if (started instanceof Promise) {
          // An implementation whose subscription starts asynchronously
          // (the SpacetimeDB connection): dispose may land before the
          // start resolves, and a failed start is a subscription error.
          started.then(
            (stop) => {
              if (disposed) stop();
              else unsubscribe = stop;
            },
            (error) => {
              if (disposed) return;
              failure = error;
              wake();
            },
          );
        } else {
          unsubscribe = started;
        }
        onCleanup(() => {
          disposed = true;
          unsubscribe?.();
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
    { name: `query:${op.name}` },
  );
}

/**
 * Run a write operation on the shared connection. Callers sit behind
 * the `getBackendUrl()` render gate, so a missing backend here is a
 * programming error, not a state to branch on — it throws into the
 * caller's error handling like any other write failure.
 *
 * @public
 */
export async function runMutation<Args, Result>(
  op: WriteOp<Args, Result>,
  args: Args,
): Promise<Result> {
  const configured = getBackendUrl();
  if (configured === undefined) throw new Error("Backend is not configured");
  return await getImpl().write(op, args);
}

/**
 * Start a read's subscription ahead of the page that will read it, so
 * that page's `createBackendQuery` finds the answer already held.
 * Meant for route `preload`s on link intent; see `./convex`'s
 * `prefetchConvexQuery` for the hold semantics the Convex side has
 * always used — each implementation warms its own cache its own way,
 * under the same contract: a failed warm-up releases at once, so no
 * error lingers for the page to inherit.
 *
 * @public
 */
export function prefetchBackendQuery<Args>(op: ReadOp<Args, unknown>, args: Args): void {
  const configured = getBackendUrl();
  if (configured === undefined) return;
  getImpl().prefetch(op, args);
}
