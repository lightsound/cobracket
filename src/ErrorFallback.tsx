import type { Accessor } from "solid-js";

// Thrown values are `unknown` in JavaScript, so every <Errored> boundary needs
// the same normalization. This component is the one place that does it; pass
// it to every boundary instead of repeating String(error()) inline.
function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export default function ErrorFallback(props: { error: Accessor<unknown>; reset: () => void }) {
  return (
    <p class="status error-fallback" role="alert">
      <span>{errorMessage(props.error())}</span>
      <button class="increment" type="button" onClick={() => props.reset()}>
        Retry
      </button>
    </p>
  );
}
