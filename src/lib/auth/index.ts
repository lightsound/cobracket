import { AuthClient, defaultStorage, runWithMutex } from "@convex-dev/auth/browser";
import type { ConvexClient } from "convex/browser";
import type { Accessor } from "solid-js";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { createConvexQuery, getConvexClient, getConvexUrl } from "../convex";

// The auth boundary (ADR 0003): Convex Auth v2 (preview) Anonymous Sign-In,
// isolated behind this module. The rest of the app knows only the @public
// exports — bootstrap, "who is the current Organizer", and "make sure I am
// one". If Auth v2 stalls or changes shape, this file is swapped, not the app.

type Auth = { client: AuthClient; convex: ConvexClient; url: string; ready: Promise<void> };

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

  const client = new AuthClient({
    mode: "spa",
    storage: defaultStorage(),
    storageNamespace: url,
    authApi: {
      refreshSession: (refreshToken) => convex.mutation(api.auth.refreshSession, { refreshToken }),
      signOut: async (refreshToken) => {
        await convex.mutation(api.auth.signOut, { refreshToken });
      },
    },
  });

  let wasAuthenticated = false;
  client.subscribe(() => {
    const { isAuthenticated } = client.getSnapshot();
    if (isAuthenticated !== wasAuthenticated) {
      wasAuthenticated = isAuthenticated;
      // Any flip invalidates what ensureOrganizer verified about the session.
      sessionVerified = false;
      convex.setAuth(client.fetchAccessToken);
    }
  });

  auth = { client, convex, url, ready: client.init() };
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

// Whether the backend confirmed the current session's user row exists. Reset
// on every auth-state flip; makes the ensureOrganizer fast path free after
// its first verification.
let sessionVerified = false;

/**
 * Make sure the caller has an Organizer identity, signing in anonymously if
 * this browser has no live session (story 1: zero sign-up). Once it resolves,
 * later Convex calls run as that Organizer: adopting the session pauses the
 * websocket synchronously, so they queue behind the re-authentication. Call
 * it from the handler of any Organizer action. Concurrent callers — double
 * clicks, other components, other tabs — collapse into one sign-in under a
 * Web Locks-backed mutex instead of minting multiple anonymous users.
 *
 * @public
 */
export async function ensureOrganizer(): Promise<void> {
  const active = getAuth();
  if (!active) return;
  await active.ready;
  if (sessionVerified && active.client.getSnapshot().isAuthenticated) return;
  await runWithMutex(`${active.url}:signInAnonymous`, async () => {
    // A session may already be live: ours, or one another tab persisted
    // while we waited for the lock — the in-memory snapshot can lag that
    // storage write, so fall back to a forced refresh, which reads the
    // shared storage (and skips the network when no session exists at all).
    const sessionLive =
      active.client.getSnapshot().isAuthenticated ||
      (await active.client.fetchAccessToken({ forceRefreshToken: true })) !== null;
    if (sessionLive) {
      // Trust it only once the backend confirms the user row still exists. A
      // live session whose user is gone (a cleared dev backend, a deleted
      // row) would otherwise dead-end: signed out in the UI, yet every
      // sign-in attempt no-ops. Drop it and mint a fresh identity instead.
      if ((await active.convex.query(api.auth.currentOrganizer, {})) !== null) {
        sessionVerified = true;
        return;
      }
      await active.client.signOut();
    }
    const result = await active.convex.mutation(api.auth.signInAnonymous, {});
    await active.client.setSession(result.tokens);
    sessionVerified = true;
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
