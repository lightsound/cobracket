import type { ConvexClient } from 'convex/browser';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';

/** First Convex result must arrive within this window, or we treat it as a failed connect. */
const CONVEX_CONNECT_TIMEOUT_MS = 3_000;
/** After a live query drops its websocket, wait this long before surfacing a disconnect error. */
const CONVEX_DISCONNECT_GRACE_MS = 1_000;

/**
 * Connection loss is not a query-function error: `onUpdate`'s `onError` only
 * runs when the UDF fails. Convex keeps the last snapshot and retries the
 * websocket silently, so Solid would otherwise stay on `<Loading>` forever
 * (never-connected) or keep a stale list (disconnect after settle).
 */
export class ConvexConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConvexConnectionError';
  }
}

type Session = {
  live: boolean;
  gotValue: boolean;
  connectTimer: ReturnType<typeof setTimeout> | undefined;
  disconnectTimer: ReturnType<typeof setTimeout> | undefined;
};

function clearTimer(id: ReturnType<typeof setTimeout> | undefined) {
  if (id !== undefined) clearTimeout(id);
}

function stopTimers(session: Session) {
  clearTimer(session.connectTimer);
  clearTimer(session.disconnectTimer);
  session.connectTimer = undefined;
  session.disconnectTimer = undefined;
}

function reportError(session: Session, onError: (error: unknown) => void, error: unknown) {
  if (!session.live) return;
  session.live = false;
  stopTimers(session);
  onError(error);
}

function onQueryValue<T>(
  session: Session,
  onValue: (result: T) => void,
  result: T,
) {
  if (!session.live) return;
  session.gotValue = true;
  clearTimer(session.connectTimer);
  session.connectTimer = undefined;
  clearTimer(session.disconnectTimer);
  session.disconnectTimer = undefined;
  onValue(result);
}

function scheduleDisconnect(
  session: Session,
  disconnectGraceMs: number,
  onError: (error: unknown) => void,
) {
  if (!session.gotValue) return;
  if (session.disconnectTimer !== undefined) return;
  session.disconnectTimer = setTimeout(() => {
    session.disconnectTimer = undefined;
    reportError(session, onError, new ConvexConnectionError('Lost connection to Convex'));
  }, disconnectGraceMs);
}

function onSocket(
  session: Session,
  connected: boolean,
  disconnectGraceMs: number,
  onError: (error: unknown) => void,
) {
  if (!session.live) return;
  if (connected) {
    clearTimer(session.disconnectTimer);
    session.disconnectTimer = undefined;
    return;
  }
  scheduleDisconnect(session, disconnectGraceMs, onError);
}

function onConnectTimeout(
  session: Session,
  convex: ConvexClient,
  onError: (error: unknown) => void,
) {
  session.connectTimer = undefined;
  if (session.gotValue) return;
  if (convex.connectionState().isWebSocketConnected) return;
  reportError(session, onError, new ConvexConnectionError('Could not connect to Convex'));
}

type SubscribeOptions = {
  connectTimeoutMs: number;
  disconnectGraceMs: number;
};

function pickTimeout(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  return value;
}

function resolvedOptions(options?: {
  connectTimeoutMs?: number;
  disconnectGraceMs?: number;
}): SubscribeOptions {
  if (options === undefined) {
    return {
      connectTimeoutMs: CONVEX_CONNECT_TIMEOUT_MS,
      disconnectGraceMs: CONVEX_DISCONNECT_GRACE_MS,
    };
  }
  return {
    connectTimeoutMs: pickTimeout(options.connectTimeoutMs, CONVEX_CONNECT_TIMEOUT_MS),
    disconnectGraceMs: pickTimeout(options.disconnectGraceMs, CONVEX_DISCONNECT_GRACE_MS),
  };
}

export function subscribeConvexResults<Query extends FunctionReference<'query'>>(
  convex: ConvexClient,
  query: Query,
  args: FunctionArgs<Query>,
  handlers: {
    onValue: (result: FunctionReturnType<Query>) => void;
    onError: (error: unknown) => void;
  },
  options?: {
    connectTimeoutMs?: number;
    disconnectGraceMs?: number;
  },
): () => void {
  const { connectTimeoutMs, disconnectGraceMs } = resolvedOptions(options);
  const session: Session = {
    live: true,
    gotValue: false,
    connectTimer: undefined,
    disconnectTimer: undefined,
  };

  session.connectTimer = setTimeout(() => {
    onConnectTimeout(session, convex, handlers.onError);
  }, connectTimeoutMs);

  const unsubscribeQuery = convex.onUpdate(
    query,
    args,
    (result) => onQueryValue(session, handlers.onValue, result),
    (error) => reportError(session, handlers.onError, error),
  );

  const applyConnection = (state: { isWebSocketConnected: boolean }) => {
    onSocket(session, state.isWebSocketConnected, disconnectGraceMs, handlers.onError);
  };
  applyConnection(convex.connectionState());
  const unsubscribeConnection = convex.subscribeToConnectionState(applyConnection);

  return () => {
    session.live = false;
    stopTimers(session);
    unsubscribeQuery();
    unsubscribeConnection();
  };
}
