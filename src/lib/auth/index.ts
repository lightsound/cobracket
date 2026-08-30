import { AuthClient, defaultStorage } from "@convex-dev/auth/browser";
import type { Accessor } from "solid-js";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { createConvexQuery, getConvexClient, getConvexUrl } from "../convex";

// The auth boundary (ADR 0003): Convex Auth v2 (preview) Anonymous Sign-In,
// isolated behind this module. The rest of the app knows only the two
// @public exports — "who is the current Organizer" and "make sure I am one".
// If Auth v2 stalls or changes shape, this file is swapped, not the app.

type Auth = { client: AuthClient; ready: Promise<void> };

let auth: Auth | undefined;

/**
 * Lazily create the session manager and wire it to the shared ConvexClient.
 *
 * `setAuth` is re-invoked whenever the authenticated state flips (sign-in,
 * sign-out, session expiry in another tab) so the websocket re-authenticates
 * and live queries re-run with the caller's verified identity.
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
      convex.setAuth(client.fetchAccessToken);
    }
  });
  convex.setAuth(client.fetchAccessToken);

  auth = { client, ready: client.init() };
  return auth;
}

let signingIn: Promise<void> | undefined;

/**
 * Make sure the caller has an Organizer identity, signing in anonymously if
 * this browser has no live session (story 1: zero sign-up). Resolves once the
 * Convex connection is authenticated as that Organizer. Idempotent and
 * single-flight; call it from the handler of any Organizer action. A no-op
 * during SSR and without a configured Convex client.
 *
 * @public
 */
export async function ensureOrganizer(): Promise<void> {
  const active = getAuth();
  if (!active) return;
  await active.ready;
  if (active.client.getSnapshot().isAuthenticated) return;
  signingIn ??= (async () => {
    try {
      const convex = getConvexClient();
      if (!convex) return;
      const result = await convex.mutation(api.auth.signInAnonymous, {});
      await active.client.setSession(result.tokens);
    } finally {
      signingIn = undefined;
    }
  })();
  await signingIn;
}

/**
 * The current Organizer's user id, or null when signed out — as the backend
 * sees it (derived from the verified access token, never from client state).
 *
 * A reactive Convex subscription: read it under `<Loading>` / `<Errored>`
 * boundaries inside a component, gated on `getConvexUrl()` like every other
 * Convex read. Flips from null to the id once `ensureOrganizer` completes.
 *
 * @public
 */
export function createOrganizer(): Accessor<Id<"users"> | null> {
  // Kick off session restore so a returning Organizer (story 25) is
  // recognized without an explicit ensureOrganizer call.
  getAuth();
  return createConvexQuery(api.auth.currentOrganizer, {});
}
