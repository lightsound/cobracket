import { onCleanup } from 'solid-js';
import type { Accessor } from 'solid-js';
import { getConvexClient } from './lib/convex';
import { ConvexConnectionError } from './lib/subscribeConvexResults';

// Thrown values are `unknown` in JavaScript, so every <Errored> boundary needs
// the same normalization. This component is the one place that does it; pass
// it to every boundary instead of repeating String(error()) inline.
function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export default function ErrorFallback(props: { error: Accessor<unknown>; reset: () => void }) {
  // Connection errors recover when the websocket is back; query errors stay
  // until Retry. Subscribe at setup — this fallback instance is created for
  // the current error, and event callbacks always read the latest accessor.
  const convex = getConvexClient();
  if (convex) {
    const tryReset = (state: { isWebSocketConnected: boolean }) => {
      if (!state.isWebSocketConnected) return;
      if (!(props.error() instanceof ConvexConnectionError)) return;
      props.reset();
    };
    tryReset(convex.connectionState());
    onCleanup(convex.subscribeToConnectionState(tryReset));
  }

  return (
    <p class="status error-fallback" role="alert">
      <span>{errorMessage(props.error())}</span>
      <button class="increment" type="button" onClick={() => props.reset()}>
        Retry
      </button>
    </p>
  );
}
