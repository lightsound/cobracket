import { createMemo, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { ReadOp, WriteOp } from "./operations";
import {
  getConvexUrl,
  prefetchConvexQuery,
  runConvexMutation,
  subscribeConvexQuery,
} from "./convex";

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

let spacetimeModule: Promise<typeof import("./spacetimedb")> | undefined;

function loadSpacetime(): Promise<typeof import("./spacetimedb")> {
  spacetimeModule ??= import("./spacetimedb");
  return spacetimeModule;
}

const spacetimeImpl: BackendImpl = {
  async subscribe(op, args, onValue, onError) {
    const adapter = await loadSpacetime();
    return adapter.spacetimeImpl.subscribe(op, args, onValue, onError);
  },
  async write(op, args) {
    const adapter = await loadSpacetime();
    return await adapter.spacetimeImpl.write(op, args);
  },
  prefetch(op, args) {
    void loadSpacetime().then((adapter) => adapter.spacetimeImpl.prefetch(op, args));
  },
};

/** @public */
export function backendSelection(): "convex" | "spacetimedb" {
  return import.meta.env.VITE_BACKEND === "spacetimedb" ? "spacetimedb" : "convex";
}

function getImpl(): BackendImpl {
  return backendSelection() === "spacetimedb" ? spacetimeImpl : convexImpl;
}

/**
 * The configured backend's URL, or undefined when this build has no
 * backend to talk to (no `VITE_CONVEX_URL` on the Convex side; on
 * the adapter side, a missing `VITE_SPACETIMEDB_HOST` or
 * `VITE_SPACETIMEDB_DB`). Pages gate their
 * reads on it and render the setup notice instead — the same
 * contract `getConvexUrl` has always carried.
 *
 * @public
 */
export function getBackendUrl(): string | undefined {
  if (backendSelection() === "spacetimedb") {
    const host = import.meta.env.VITE_SPACETIMEDB_HOST;
    const db = import.meta.env.VITE_SPACETIMEDB_DB;
    return typeof host === "string" && host.length > 0 && typeof db === "string" && db.length > 0
      ? host
      : undefined;
  }
  return getConvexUrl();
}

/**
 * Bridges a backend subscription into Solid's async model — contract: docs/adr/0004-deliberate-pre-release-stack.md.
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
