import { ConvexClient } from 'convex/browser';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import { createSignal, onCleanup } from 'solid-js';

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

export function createConvexQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  args: FunctionArgs<Query>,
) {
  const [data, setData] = createSignal<FunctionReturnType<Query> | undefined>();
  const [error, setError] = createSignal<Error | undefined>();
  const convex = getConvexClient();
  if (!convex) {
    return { data, error };
  }

  const unsubscribe = convex.onUpdate(
    query,
    args,
    (result) => {
      setError(undefined);
      setData(() => result);
    },
    (err) => setError(err),
  );
  onCleanup(unsubscribe);

  return { data, error };
}
