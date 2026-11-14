import {
  bindSpacetimeIdentity,
  getSpacetimeConfig,
  getSpacetimeConnection,
  onSpacetimeSession,
  resetSpacetimeIdentity,
  whenSpacetimeSessionReady,
} from "../spacetimedb";
import type { SessionState } from "../spacetimedb-model";

// The SpacetimeDB implementation behind the auth boundary
// (`./index`): native Identity plus the module's binding table —
// no sign-in provider, no keys, no session to refresh (ADR 0031).
// What the Convex implementation beside it (`./convex`) does with
// an AuthClient, a token lifecycle, and a cross-tab mutex, this one
// does with three facts: the server mints the identity on connect
// and the adapter persists its token (the cross-tab first-connect
// race is serialized there, at the connection, where it lives);
// the module binds the identity to its app_user through the
// bindIdentity reducer (and would bind on any first reducer call,
// so this is establishment, not a gate); and the session_state view
// reports what the identity resolves to, in the same three kinds
// the Convex sessionState query returned.

let started = false;

export function initSpacetimeAuth(): void {
  if (started) return;
  started = true;
  const config = getSpacetimeConfig();
  if (config === undefined) return;
  // Build the connection (and with it the session feed) now, so the
  // first ensureOrganizer and the app-wide currentOrganizer read
  // find it warm. A failure here is not lost: it resurfaces through
  // the reads and writes that need the connection.
  void getSpacetimeConnection().catch(() => {});
}

let inflight: Promise<void> | undefined;

export async function ensureSpacetimeOrganizer(): Promise<void> {
  inflight ??= establish().finally(() => {
    inflight = undefined;
  });
  return inflight;
}

async function establish(): Promise<void> {
  await getSpacetimeConnection();
  let state = await whenSpacetimeSessionReady();
  if (state.kind === "organizer") return;
  if (state.kind === "user_missing") {
    // The binding's app_user row is gone (a cleared backend, a
    // deleted user): the identity is genuinely dead and can never
    // act again. Drop it and start over tokenless — the Convex
    // path's sign-out and fresh sign-in, in this platform's shape.
    await resetSpacetimeIdentity();
    state = await whenSpacetimeSessionReady();
    if (state.kind === "organizer") return;
  }
  await bindSpacetimeIdentity();
  await waitForOrganizer();
}

/** Resolve once the session feed reports a live binding; bounded, as a stuck feed is a broken backend. */
async function waitForOrganizer(): Promise<void> {
  const deadline = Date.now() + 10_000;
  await new Promise<void>((resolve, reject) => {
    const stop = onSpacetimeSession((state: SessionState) => {
      if (state.kind === "organizer") {
        cleanup();
        resolve();
      }
    });
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        cleanup();
        reject(new Error("Signed in, but the new session's user could not be resolved."));
      }
    }, 100);
    function cleanup(): void {
      clearInterval(timer);
      stop();
    }
  });
}
