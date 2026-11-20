import {
  bindSpacetimeIdentity,
  getSpacetimeConfig,
  getSpacetimeConnection,
  resetSpacetimeIdentity,
  waitForSpacetimeSession,
  whenSpacetimeSessionReady,
} from "../spacetimedb";

// The SpacetimeDB auth model: docs/adr/0031-adopt-spacetimedb-as-the-backend.md.

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

async function waitForOrganizer(): Promise<void> {
  await waitForSpacetimeSession(
    (state) => state.kind === "organizer",
    "Signed in, but the new session's user could not be resolved.",
  );
}
