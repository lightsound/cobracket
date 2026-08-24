import { describe, expect, mock, test } from 'bun:test';
import type { ConvexClient } from 'convex/browser';
import {
  ConvexConnectionError,
  subscribeConvexResults,
} from './subscribeConvexResults';

type ConnectionSnapshot = { isWebSocketConnected: boolean };

function createMockClient(initial: ConnectionSnapshot = { isWebSocketConnected: false }) {
  let connection = { ...initial };
  const connectionListeners = new Set<(state: ConnectionSnapshot) => void>();
  let onValue: ((value: unknown) => void) | undefined;
  let onQueryError: ((error: Error) => void) | undefined;
  let queryUnsubscribed = false;
  let connectionUnsubscribed = false;

  const client = {
    onUpdate(
      _query: unknown,
      _args: unknown,
      next: (value: unknown) => void,
      fail?: (error: Error) => void,
    ) {
      onValue = next;
      onQueryError = fail;
      return () => {
        queryUnsubscribed = true;
        onValue = undefined;
        onQueryError = undefined;
      };
    },
    subscribeToConnectionState(listener: (state: ConnectionSnapshot) => void) {
      connectionListeners.add(listener);
      return () => {
        connectionUnsubscribed = true;
        connectionListeners.delete(listener);
      };
    },
    connectionState() {
      return connection;
    },
  };

  return {
    client: client as unknown as ConvexClient,
    queryUnsubscribed: () => queryUnsubscribed,
    connectionUnsubscribed: () => connectionUnsubscribed,
    pushValue(value: unknown) {
      onValue?.(value);
    },
    pushQueryError(error: Error) {
      onQueryError?.(error);
    },
    setConnected(isWebSocketConnected: boolean) {
      connection = { isWebSocketConnected };
      for (const listener of connectionListeners) listener(connection);
    },
  };
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe('subscribeConvexResults', () => {
  test('delivers query snapshots', () => {
    const mockClient = createMockClient({ isWebSocketConnected: true });
    const onValue = mock(() => {});
    const onError = mock(() => {});

    subscribeConvexResults(
      mockClient.client,
      {} as never,
      {},
      { onValue, onError },
      { connectTimeoutMs: 50, disconnectGraceMs: 50 },
    );

    mockClient.pushValue([{ _id: '1' }]);
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  test('times out if the websocket never connects and no result arrives', async () => {
    const mockClient = createMockClient({ isWebSocketConnected: false });
    const onValue = mock(() => {});
    const onError = mock(() => {});

    subscribeConvexResults(
      mockClient.client,
      {} as never,
      {},
      { onValue, onError },
      { connectTimeoutMs: 20, disconnectGraceMs: 50 },
    );

    await wait(40);
    expect(onValue).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(ConvexConnectionError);
    expect((error as Error).message).toBe('Could not connect to Convex');
  });

  test('does not time out while the websocket is connected and waiting for the first result', async () => {
    const mockClient = createMockClient({ isWebSocketConnected: true });
    const onValue = mock(() => {});
    const onError = mock(() => {});

    subscribeConvexResults(
      mockClient.client,
      {} as never,
      {},
      { onValue, onError },
      { connectTimeoutMs: 20, disconnectGraceMs: 50 },
    );

    await wait(40);
    expect(onError).not.toHaveBeenCalled();
    mockClient.pushValue([]);
    expect(onValue).toHaveBeenCalledTimes(1);
  });

  test('errors after a grace period when a live query loses its websocket', async () => {
    const mockClient = createMockClient({ isWebSocketConnected: true });
    const onValue = mock(() => {});
    const onError = mock(() => {});

    subscribeConvexResults(
      mockClient.client,
      {} as never,
      {},
      { onValue, onError },
      { connectTimeoutMs: 200, disconnectGraceMs: 20 },
    );

    mockClient.pushValue(['ok']);
    mockClient.setConnected(false);
    expect(onError).not.toHaveBeenCalled();

    await wait(40);
    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(ConvexConnectionError);
    expect((error as Error).message).toBe('Lost connection to Convex');
  });

  test('ignores brief websocket drops shorter than the grace period', async () => {
    const mockClient = createMockClient({ isWebSocketConnected: true });
    const onValue = mock(() => {});
    const onError = mock(() => {});

    subscribeConvexResults(
      mockClient.client,
      {} as never,
      {},
      { onValue, onError },
      { connectTimeoutMs: 200, disconnectGraceMs: 40 },
    );

    mockClient.pushValue(['ok']);
    mockClient.setConnected(false);
    await wait(15);
    mockClient.setConnected(true);
    mockClient.pushValue(['still-ok']);
    await wait(40);

    expect(onError).not.toHaveBeenCalled();
    expect(onValue).toHaveBeenCalledTimes(2);
  });

  test('forwards query-function errors', () => {
    const mockClient = createMockClient({ isWebSocketConnected: true });
    const onValue = mock(() => {});
    const onError = mock(() => {});

    subscribeConvexResults(
      mockClient.client,
      {} as never,
      {},
      { onValue, onError },
      { connectTimeoutMs: 50, disconnectGraceMs: 50 },
    );

    const queryError = new Error('UDF exploded');
    mockClient.pushQueryError(queryError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(queryError);
  });

  test('unsubscribe clears timers and listeners', async () => {
    const mockClient = createMockClient({ isWebSocketConnected: false });
    const onValue = mock(() => {});
    const onError = mock(() => {});

    const stop = subscribeConvexResults(
      mockClient.client,
      {} as never,
      {},
      { onValue, onError },
      { connectTimeoutMs: 20, disconnectGraceMs: 20 },
    );
    stop();

    await wait(40);
    mockClient.pushValue(['late']);
    mockClient.setConnected(false);
    expect(onValue).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(mockClient.queryUnsubscribed()).toBe(true);
    expect(mockClient.connectionUnsubscribed()).toBe(true);
  });
});
