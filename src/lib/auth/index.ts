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
 * vanish with no client-side auth flip), so there is no client-side
 * "already verified" cache: every attempt asks the server. The common case —
 * a cached token the server confirms — is one read-only HTTP query with no
 * lock taken; only an unconfirmed session enters the cross-tab lock and
 * refreshes. Every call is HTTP, so an unreachable server rejects promptly
 * (surfacing the error, releasing the lock) instead of queueing forever on
 * a disconnected websocket.
 *
 * @public
 */
export async function ensureOrganizer(): Promise<void> {
  const active = getAuth();
  if (!active) return;
  await active.ready;
  if (await cachedSessionSatisfies(active)) return;
  await runWithMutex(`${active.url}:signInAnonymous`, () => establishOrganizerSession(active));
}

/**
 * The unlocked fast path: true when the caller can proceed without the
 * cross-tab lock — the cached token maps to an existing Organizer, or the
 * server is unreachable, which cannot disprove a locally live session (the
 * caller's own Convex call then decides: it queues on the websocket and
 * proceeds when the connection recovers).
 */
async function cachedSessionSatisfies(active: Auth): Promise<boolean> {
  const cached = active.client.getAccessToken();
  if (cached === null) return false;
  try {
    return (await fetchSessionState(active.url, cached)) === "organizer";
  } catch (error) {
    // fetch signals network failure as a TypeError; anything else is the
    // server actively rejecting the token (an expired or unverifiable JWT
    // is refused before the query runs) — take the locked path, which
    // refreshes to a fresh token and re-verifies.
    return error instanceof TypeError;
  }
}

/** The locked slow path: reconcile whatever session exists, else sign in. */
async function establishOrganizerSession(active: Auth): Promise<void> {
  // A fresh token proves some session is live: ours, or one another tab
  // persisted while we waited for the lock — the forced refresh reads the
  // shared storage. It skips the network only when this browser holds no
  // refresh token at all; a token a cleared backend no longer recognizes
  // costs one round trip that returns null.
  const token = await active.client.fetchAccessToken({ forceRefreshToken: true });
  if (token !== null && (await reconcileLiveSession(active, token))) return;
  const result = await active.httpClient.mutation(api.auth.signInAnonymous, {});
  await active.client.setSession(result.tokens);
  if ((await fetchSessionState(active.url, result.tokens.accessToken)) !== "organizer") {
    throw new Error("Signed in, but the new session's user could not be resolved.");
  }
}

/**
 * Decide what a live session's verification result means: satisfied
 * (organizer exists) or genuinely dead (sign out, return false so the
 * caller mints a fresh identity).
 *
 * A deployment that cannot verify its own tokens (issuer/JWKS drift) never
 * reaches the verdicts here: Convex refuses the unverifiable JWT before the
 * query runs, so fetchSessionState throws the server's own diagnostic —
 * which surfaces to the caller with the session kept intact. Verified
 * empirically against the local backend (InvalidAuthHeader, not a null
 * identity).
 */
async function reconcileLiveSession(active: Auth, token: string): Promise<boolean> {
  const state = await fetchSessionState(active.url, token);
  if (state === "organizer") return true;
  // user_missing (or, unreachable with a token sent, unauthenticated): the
  // JWT verifies but its user row is gone — a cleared dev backend, a
  // deleted row. The session is genuinely dead.
  await active.client.signOut();
  return false;
}

/**
 * Ask the backend what the given access token resolves to. A dedicated HTTP
 * client per call: the websocket client's query() can answer from a stale
 * pre-auth local cache when a component subscribes to the same query, and
 * authenticating the shared HTTP client would leak a stale bearer token
 * into later refresh calls.
 */
async function fetchSessionState(
  url: string,
  token: string,
): Promise<"unauthenticated" | "user_missing" | "organizer"> {
  const verifier = new ConvexHttpClient(url);
  verifier.setAuth(token);
  return (await verifier.query(api.auth.sessionState, {})).kind;
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
