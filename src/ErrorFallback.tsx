import type { Accessor, Element } from "solid-js";

// Thrown values are `unknown` in JavaScript, so every error surface needs the
// same normalization. This module is the one place that does it — boundaries
// take errorFallback below; handler catch blocks call this directly.
export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

// The one presentational error surface: every error message renders through
// it so the classes, role, and structure cannot drift between call sites.
export function ErrorNotice(props: { message: string; children?: Element }) {
  return (
    <p class="status error-fallback" role="alert">
      <span>{props.message}</span>
      {props.children}
    </p>
  );
}

// The adapter every <Errored> boundary passes as its fallback.
export function errorFallback(error: Accessor<unknown>, reset: () => void) {
  return (
    <ErrorNotice message={errorMessage(error())}>
      <button class="increment" type="button" onClick={() => reset()}>
        Retry
      </button>
    </ErrorNotice>
  );
}
