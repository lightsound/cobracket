import { AuthClient, defaultStorage, runWithMutex } from "@convex-dev/auth/browser";
import { ConvexHttpClient } from "convex/browser";
import type { Accessor } from "solid-js";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { createConvexQuery, getConvexClient, getConvexUrl } from "../convex";

// The auth boundary (ADR 0003): Convex Auth v2 (preview) Anonymous Sign-In,
// isolated behind this module. The rest of the app knows only the @public
// exports — bootstrap, "who is the current Organizer", and "make sure I am
// one". If Auth v2 stalls or changes shape, this file is swapped, not the app.

type Auth = {
  client: AuthClient;
  httpClient: ConvexHttpClient;
  url: string;
  ready: Promise<void>;
};

let auth: Auth | undefined;

/**
 * Lazily create the session manager and wire it to the shared ConvexClient.
 *
 * `setAuth` runs on every authenticated-state flip (session restore from
 * `init`, sign-in, sign-out, cross-tab expiry) so the websocket
 * re-authenticates and live queries re-run with the caller's verified
 * identity. There is deliberately no eager call: before `init` resolves the
 * client has no token, so it would only stall the socket for a null fetch.
 */
function getAuth(): Auth | undefined {
  if (auth) return auth;
  // getConvexClient is undefined during SSR and without VITE_CONVEX_URL;
  // both mean "no session to manage here".
  const convex = getConvexClient();
  const url = getConvexUrl();
  if (!convex || !url) return undefined;

  // Every auth call goes over a separate HTTP client, never the websocket
  // client. A refresh runs while the websocket is paused waiting for the very
  // token the refresh produces, so routing it through `convex` would deadlock
  // (e.g. any visit after the stored access token expired) — and HTTP calls
  // reject promptly when the server is unreachable instead of queueing
  // forever on a disconnected websocket.
  const httpClient = new ConvexHttpClient(url);
  const client = new AuthClient({
    mode: "spa",
    storage: defaultStorage(),
    storageNamespace: url,
    authApi: {
      refreshSession: (refreshToken) =>
        httpClient.mutation(api.auth.refreshSession, { refreshToken }),
      signOut: async (refreshToken) => {
        await httpClient.mutation(api.auth.signOut, { refreshToken });
      },
    },
  });

  let wasAuthenticated = false;
  client.subscribe(() => {
    const { isAuthenticated } = client.getSnapshot();
    if (isAuthenticated !== wasAuthenticated) {
      wasAuthenticated = isAuthenticated;
      convex.setAuth(client.fetchAccessToken);
    }
  });

  auth = { client, httpClient, url, ready: client.init() };
  return auth;
}

/**
 * Bootstrap the auth session for this browser: restore a persisted session
 * (story 25) and keep the Convex connection authenticated from then on.
 * Call once from the app root; idempotent, a no-op during SSR and without a
 * configured Convex client.
 *
 * @public
 */
export function initAuth(): void {
  getAuth();
}

/**
 * Make sure the caller has an Organizer identity, signing in anonymously if
 * this browser has no live session (story 1: zero sign-up). Once it resolves,
 * later Convex calls run as that Organizer: adopting the session pauses the
 * websocket synchronously, so they queue behind the re-authentication. Call
 * it from the handler of any Organizer action. Concurrent callers — double
 * clicks, other components, other tabs — collapse into one sign-in under a
 * Web Locks-backed mutex instead of minting multiple anonymous users.
 *
 * Whether the session's user row still exists is backend state (a row can
 * vanish with no client-side auth flip), so there is deliberately no
 * client-side "already verified" fast path: every attempt re-establishes the
 * session and asks the server under the lock — two small HTTP round trips,
 * human-action-paced. A cache here would recreate the dead-end the check
 * exists to break; every call inside the lock is HTTP, so an unreachable
 * server rejects promptly (surfacing the error, releasing the lock) instead
 * of queueing forever on a disconnected websocket.
 *
 * @public
 */
export async function ensureOrganizer(): Promise<void> {
  const active = getAuth();
  if (!active) return;
  await active.ready;
  await runWithMutex(`${active.url}:signInAnonymous`, async () => {
    // A fresh token proves some session is live: ours, or one another tab
    // persisted while we waited for the lock — the forced refresh reads the
    // shared storage (and skips the network when no session exists at all,
    // including one a cleared backend no longer recognizes).
    const token = await active.client.fetchAccessToken({ forceRefreshToken: true });
    if (token !== null) {
      // Trust the session only if the backend still knows its user. Verify
      // with the token we just minted over a dedicated HTTP client — the
      // websocket client's query() can answer from a stale pre-auth local
      // cache when a component subscribes to the same query. A live session
      // whose user row is gone (a deleted row) would otherwise dead-end:
      // signed out in the UI, yet every sign-in attempt a no-op.
      const verifier = new ConvexHttpClient(active.url);
      verifier.setAuth(token);
      if ((await verifier.query(api.auth.currentOrganizer, {})) !== null) return;
      await active.client.signOut();
    }
    const result = await active.httpClient.mutation(api.auth.signInAnonymous, {});
    await active.client.setSession(result.tokens);
  });
}

/**
 * The current Organizer's user id, or null when signed out — as the backend
 * sees it (derived from the verified access token, never from client state).
 *
 * A reactive Convex subscription: read it under `<Loading>` / `<Errored>`
 * boundaries inside a component, gated on `getConvexUrl()` like every other
 * Convex read. Flips from null to the id once the session is live.
 *
 * @public
 */
export function createOrganizer(): Accessor<Id<"users"> | null> {
  return createConvexQuery(api.auth.currentOrganizer, {});
}
