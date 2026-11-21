import { createMemo, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { ReadOp, WriteOp } from "./operations";

type Unsubscribe = () => void;

let spacetimeModule: Promise<typeof import("./spacetimedb")> | undefined;

function loadSpacetime(): Promise<typeof import("./spacetimedb")> {
  spacetimeModule ??= import("./spacetimedb");
  return spacetimeModule;
}

/**
 * The backend's URL, or undefined when this build has no backend to
 * talk to (a missing `VITE_SPACETIMEDB_HOST` or `VITE_SPACETIMEDB_DB`).
 * Pages gate their reads on it and render the setup notice instead.
 *
 * @public
 */
export function getBackendUrl(): string | undefined {
  const host = import.meta.env.VITE_SPACETIMEDB_HOST;
  const db = import.meta.env.VITE_SPACETIMEDB_DB;
  return typeof host === "string" && host.length > 0 && typeof db === "string" && db.length > 0
    ? host
    : undefined;
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
      // returning undefined there — the implementation resolves its
      // client inside this computation and finds none.
      const configured = getBackendUrl();
      const resolvedArgs = readArgs();

      let current: Result | undefined;
      let version = 0;
      let failure: unknown;
      let disposed = false;
      let wake = () => {};

      if (configured !== undefined) {
        let unsubscribe: Unsubscribe | undefined;
        // The subscription starts asynchronously (the SpacetimeDB
        // connection is built on first use): dispose may land before
        // the start resolves, and a failed start is a subscription
        // error.
        const started = loadSpacetime().then((adapter) =>
          adapter.spacetimeImpl.subscribe(
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
          ),
        );
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
  const adapter = await loadSpacetime();
  return await adapter.spacetimeImpl.write(op, args);
}

/**
 * Start a read's subscription ahead of the page that will read it, so
 * that page's `createBackendQuery` finds the answer already held.
 * Meant for route `preload`s on link intent; see `./spacetimedb`'s
 * prefetch for the hold semantics — each warm-up is held for a grace
 * period, and a failed warm-up releases at once, so no error lingers
 * for the page to inherit.
 *
 * @public
 */
export function prefetchBackendQuery<Args>(op: ReadOp<Args, unknown>, args: Args): void {
  const configured = getBackendUrl();
  if (configured === undefined) return;
  void loadSpacetime().then((adapter) => adapter.spacetimeImpl.prefetch(op, args));
}
