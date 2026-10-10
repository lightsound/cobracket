import { OBSERVE } from "solid-js";

/**
 * How many sources each reactive scope tracked, read from the attribution
 * engine's own records.
 *
 * The diagnostics gates used to answer this through `[WIDE_SCOPE_DEPS]`, and
 * since Solid 2.0.0-rc.14 that code cannot see the case they were built for.
 * A per-row `<Show>` inside a `<For>` makes every row a source of the list's
 * insert effect, one each, and that effect is `@solidjs/web`'s
 * child-resolution pass, which the engine now marks wide by construction and
 * leaves out of the check; the check's default also rose from 30 sources to
 * 200. Only the always-on `[HUGE_FAN_IN]` still counts that effect, from 2000
 * sources. Measured on rc.14 with the defect re-injected into `BracketView`:
 * the 31-match fixture and the 16-player browser scenario both passed, while
 * the insert effect tracked 31 sources.
 *
 * The count is still in the engine, on every `create` and `rerun` record
 * (`depCount`), for every scope, framework ones included. The artifact does
 * not carry it — it keeps re-runs only, in a ring buffer of 200, and no
 * creations — so the gates collect it beside their capture and hand it to
 * the shared verdict (`assertGate` in `src/diagnostics-verdict.ts`).
 *
 * Needs a development build with the attribution engine enabled, which both
 * gates have. HMR wrappers would count as sources, and both gates run with
 * solid-refresh off.
 */

/**
 * One scope, at its widest run: how many sources it tracked.
 *
 * @public
 */
export interface ScopeWidth {
  name: string;
  kind: "effect" | "memo";
  sources: number;
}

/**
 * Start recording scope widths; the returned function stops and reports them.
 *
 * @public
 */
export function watchScopeWidths(): () => ScopeWidth[] {
  if (OBSERVE === undefined) {
    throw new Error("Scope widths need a development build of Solid (OBSERVE is undefined).");
  }
  const widest = new Map<number, ScopeWidth>();
  const note = (event: {
    nodeId: number;
    nodeName: string;
    nodeKind: "effect" | "memo";
    depCount: number;
  }) => {
    const seen = widest.get(event.nodeId);
    if (seen === undefined || seen.sources < event.depCount) {
      widest.set(event.nodeId, {
        name: event.nodeName,
        kind: event.nodeKind,
        sources: event.depCount,
      });
    }
  };
  const stops = [
    OBSERVE.records.subscribe("create", note),
    OBSERVE.records.subscribe("rerun", note),
  ];
  return () => {
    for (const stop of stops) stop();
    return [...widest.values()];
  };
}

/**
 * Where the browser gate finds the recorder in a page served in `--mode e2e`.
 *
 * @public
 */
export const SCOPE_WIDTHS_GLOBAL = "__COBRACKET_SCOPE_WIDTHS__";

/**
 * The page side of the browser gate: `begin()` before its capture, `end()`
 * after, both through `page.evaluate`.
 *
 * @public
 */
export interface ScopeWidthsBridge {
  begin(): void;
  end(): ScopeWidth[];
}

/**
 * Install the recorder for the browser gate. Called by `initDevDiagnostics`
 * in `--mode e2e` only.
 *
 * @public
 */
export function exposeScopeWidths(): void {
  let stop: (() => ScopeWidth[]) | undefined;
  const bridge: ScopeWidthsBridge = {
    begin() {
      stop?.();
      stop = watchScopeWidths();
    },
    end() {
      if (stop === undefined) throw new Error("Scope widths: end() without begin().");
      const widths = stop();
      stop = undefined;
      return widths;
    },
  };
  (globalThis as Record<string, unknown>)[SCOPE_WIDTHS_GLOBAL] = bridge;
}
