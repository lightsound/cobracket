import { isServer } from "@solidjs/web";
import { SenderError } from "spacetimedb";
import { DbConnection } from "../../spacetimedb/bindings";
import type {
  CurrentOrganizerRow,
  DisciplineSuggestionRow,
  MyTournamentRow,
  OrganizerMatchRow,
  OrganizerParticipantRow,
  OrganizerResultRow,
  OrganizerTournamentRow,
  SessionStateRow,
  SharedMatchRow,
  SharedParticipantRow,
  SharedResultRow,
  SharedTournamentRow,
} from "../../spacetimedb/bindings/types";
import type { ReadOp, WriteOp } from "./operations";
import {
  composeCurrentOrganizer,
  composeMyTournaments,
  composeOrganizerTournament,
  composeSessionState,
  composeSharedTournament,
  filterSuggestions,
  formatArgToBinding,
  OUTCOME_TO_BINDING,
  parseBulkNames,
  synthesizeAddedParticipants,
  synthesizeCreated,
  synthesizeReport,
} from "./spacetimedb-model";
import type {
  OrganizerComposition,
  ReportResultArgs,
  SessionState,
  TournamentKnowledge,
} from "./spacetimedb-model";
import type {
  CreateTournamentArgs,
  Outcome,
  ParticipantView,
  TournamentSummary,
  UpdateTournamentArgs,
} from "./operations";

// The SpacetimeDB implementation behind the data seam (`./backend`):
// one DbConnection, the view subscriptions the read operations
// compose from, and the reducer calls the write operations dispatch
// to — the counterpart of `./convex`, selected when a build sets
// VITE_BACKEND=spacetimedb (see `./backend`). Plan §2.5 is the design;
// `./spacetimedb-model` holds the pure half (row mapping, composition,
// write-argument mapping, result synthesis) and this module the live half.
//
// Three platform facts shape everything below, all measured during
// the migration (the M1 spike, the M2 connection suite):
//
// - Every read surface is a view; argument views have no primary
//   key, so their rows arrive as delete+insert pairs and a view's
//   cached row set is replaced on change, never updated in place.
//   The adapter therefore reconciles each view's rows from the
//   client cache on every event batch, and hands pages their
//   contract rows through an identity cache (see "Contract row
//   identity" below): a row whose fields are unchanged keeps its
//   object across deliveries, as the Convex client's cache hands
//   back — the delivery shape the seam's consumers are written
//   against.
// - A view's client cache merges the rows of every live subscription
//   of that view on the connection, and the rows carry no
//   tournamentId to sort them by. So tournament-scoped views are
//   subscribed one scope at a time (see "Scopes" below): the cache
//   of an organizer view only ever holds the current tournament's
//   rows, and composition keys from the subscription's arguments.
// - A reducer's deliberate refusal crosses the wire as a
//   SenderError carrying the module guard's own text (2.15's
//   documented failure channel — the module's guards throw
//   SenderError, never a plain Error for a refusal), and the write
//   path surfaces that text as the write's failure: the failure
//   contract the pages print. Anything else that rejects a call —
//   an InternalError (a host fault, which is what a plain throw
//   arrives as) or a transport failure — surfaces as the one
//   generic message below.

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SpacetimeConfig {
  host: string;
  db: string;
}

/**
 * The SpacetimeDB configuration for this build, or undefined when
 * the host/database env vars are not both set.
 *
 * @public
 */
export function getSpacetimeConfig(): SpacetimeConfig | undefined {
  const host = import.meta.env.VITE_SPACETIMEDB_HOST;
  const db = import.meta.env.VITE_SPACETIMEDB_DB;
  if (typeof host !== "string" || host.length === 0) return undefined;
  if (typeof db !== "string" || db.length === 0) return undefined;
  return { host, db };
}

// ---------------------------------------------------------------------------
// The one generic write failure (see the header)
// ---------------------------------------------------------------------------

const GENERIC_WRITE_ERROR = "The operation could not be completed. Please try again.";

// ---------------------------------------------------------------------------
// Connection singleton and its token
// ---------------------------------------------------------------------------

// The token is the credential (the module's identity seam, ADR
// 0031): the server mints the identity on a tokenless connect and
// the SDK hands the token back through onConnect; persisting it is
// the app's job (the SDK does not touch storage). Namespaced by
// host and database, like the Convex auth storage was by URL.
function tokenKey(config: SpacetimeConfig): string {
  return `cobracket.spacetimedb.token:${config.host}:${config.db}`;
}

function readStoredToken(config: SpacetimeConfig): string | undefined {
  if (isServer) return undefined;
  try {
    return window.localStorage.getItem(tokenKey(config)) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeToken(config: SpacetimeConfig, token: string): void {
  if (isServer) return;
  try {
    window.localStorage.setItem(tokenKey(config), token);
  } catch {
    // Storage can refuse (private modes, quotas); the session then
    // lasts as long as this page's connection does.
  }
}

function clearStoredToken(config: SpacetimeConfig): void {
  if (isServer) return;
  try {
    window.localStorage.removeItem(tokenKey(config));
  } catch {
    // Nothing to clear that this client could have written.
  }
}

interface LiveConnection {
  config: SpacetimeConfig;
  conn: DbConnection;
}

let live: LiveConnection | undefined;
let livePromise: Promise<LiveConnection> | undefined;

function buildConnection(config: SpacetimeConfig): Promise<LiveConnection> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const conn = DbConnection.builder()
      .withUri(config.host)
      .withDatabaseName(config.db)
      .withToken(readStoredToken(config))
      .onConnect((connected, _identity, token) => {
        storeToken(config, token);
        if (!settled) {
          settled = true;
          resolve({ config, conn: connected });
        }
        onConnected(connected);
      })
      .onConnectError((_ctx, error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      })
      .build();
    void conn;
  });
}

/**
 * The shared connection, built on first use.
 *
 * @public
 */
export function getSpacetimeConnection(): Promise<DbConnection> {
  return getLive().then((entry) => entry.conn);
}

/**
 * Build the connection, serializing a tokenless first connect
 * across tabs: two tabs opening the app together, neither holding a
 * stored token yet, would otherwise each be minted their own
 * identity and each persist it (last writer wins), leaving one tab
 * acting as a second anonymous user (plan §5, Q5 — the race the
 * Convex side's sign-in mutex prevented). Under the Web Lock, the
 * second tab's build re-reads storage after the first's token
 * landed and connects as the same identity. Once a token exists,
 * no lock is taken.
 */
async function buildConnectionLocked(config: SpacetimeConfig): Promise<LiveConnection> {
  // The lock manager is absent outside secure contexts — and some
  // DOM implementations expose it as null rather than omitting it,
  // so presence is not enough; it must be a usable object.
  const locks: LockManager | undefined =
    isServer || typeof navigator === "undefined"
      ? undefined
      : ((navigator.locks as LockManager | null) ?? undefined);
  if (
    readStoredToken(config) !== undefined ||
    locks === undefined ||
    typeof locks.request !== "function"
  ) {
    return buildConnection(config);
  }
  return await locks.request(`${tokenKey(config)}:connect`, () => buildConnection(config));
}

function getLive(): Promise<LiveConnection> {
  const config = getSpacetimeConfig();
  if (config === undefined) {
    return Promise.reject(new Error("SpacetimeDB is not configured"));
  }
  if (live !== undefined && live.config.host === config.host && live.config.db === config.db) {
    return Promise.resolve(live);
  }
  if (livePromise === undefined) {
    const building = buildConnectionLocked(config).then((entry) => {
      live = entry;
      return entry;
    });
    livePromise = building;
    // A failed first connect must not brick the adapter for the
    // page's lifetime: forget the attempt so the next use retries
    // (the SDK's own reconnect policy covers drops after a connect).
    building.catch(() => {
      if (livePromise === building) livePromise = undefined;
    });
  }
  return livePromise;
}

// ---------------------------------------------------------------------------
// View state: reconciled snapshots of every view's rows
// ---------------------------------------------------------------------------

type ViewName =
  | "myTournaments"
  | "sessionState"
  | "currentOrganizer"
  | "organizerTournament"
  | "organizerParticipants"
  | "organizerMatches"
  | "organizerResults"
  | "sharedTournament"
  | "sharedParticipants"
  | "sharedMatches"
  | "sharedResults"
  | "suggestDisciplines";

/** The latest reconciled rows of each view, keyed per view below. */
const viewRows = {
  myTournaments: new Map<string, MyTournamentRow>(),
  sessionState: new Map<string, SessionStateRow>(),
  currentOrganizer: new Map<string, CurrentOrganizerRow>(),
  organizerTournament: new Map<string, OrganizerTournamentRow>(),
  organizerParticipants: new Map<string, OrganizerParticipantRow>(),
  organizerMatches: new Map<string, OrganizerMatchRow>(),
  organizerResults: new Map<string, OrganizerResultRow>(),
  sharedTournament: new Map<string, SharedTournamentRow>(),
  sharedParticipants: new Map<string, SharedParticipantRow>(),
  sharedMatches: new Map<string, SharedMatchRow>(),
  sharedResults: new Map<string, SharedResultRow>(),
  suggestDisciplines: new Map<string, DisciplineSuggestionRow>(),
};

const dirtyViews = new Set<ViewName>();
let flushQueued = false;

function markDirty(view: ViewName): void {
  dirtyViews.add(view);
  if (!flushQueued) {
    flushQueued = true;
    queueMicrotask(flush);
  }
}

function flush(): void {
  flushQueued = false;
  if (live === undefined) {
    dirtyViews.clear();
    return;
  }
  const conn = live.conn;
  const dirty = new Set(dirtyViews);
  dirtyViews.clear();
  for (const view of dirty) {
    reconcileView(conn, view);
  }
  refreshChannels(dirty);
  refreshSessionListeners();
}

interface ViewSource {
  rows: (db: DbConnection["db"]) => Iterable<unknown>;
  keyOf: (row: never) => string;
}

function viewSource<Row>(
  rows: (db: DbConnection["db"]) => Iterable<Row>,
  keyOf: (row: Row) => string,
): ViewSource {
  return {
    rows: rows as (db: DbConnection["db"]) => Iterable<unknown>,
    keyOf: keyOf as (row: never) => string,
  };
}

/** Each view's cache source: where its rows iterate from, and the key they file under. */
const VIEW_SOURCES: Record<ViewName, ViewSource> = {
  myTournaments: viewSource(
    (db) => db.myTournaments.iter(),
    (row) => String(row.tournamentId),
  ),
  sessionState: viewSource(
    (db) => db.sessionState.iter(),
    () => "state",
  ),
  currentOrganizer: viewSource(
    (db) => db.currentOrganizer.iter(),
    () => "row",
  ),
  organizerTournament: viewSource(
    (db) => db.organizerTournament.iter(),
    () => "header",
  ),
  organizerParticipants: viewSource(
    (db) => db.organizerParticipants.iter(),
    (row) => String(row.participantId),
  ),
  organizerMatches: viewSource(
    (db) => db.organizerMatches.iter(),
    (row) => String(row.matchId),
  ),
  organizerResults: viewSource(
    (db) => db.organizerResults.iter(),
    (row) => String(row.resultId),
  ),
  sharedTournament: viewSource(
    (db) => db.sharedTournament.iter(),
    () => "header",
  ),
  sharedParticipants: viewSource(
    (db) => db.sharedParticipants.iter(),
    (row) => String(row.participantId),
  ),
  sharedMatches: viewSource(
    (db) => db.sharedMatches.iter(),
    (row) => row.key,
  ),
  sharedResults: viewSource(
    (db) => db.sharedResults.iter(),
    (row) => String(row.seq),
  ),
  suggestDisciplines: viewSource(
    (db) => db.suggestDisciplines.iter(),
    (row) => row.name,
  ),
};

function reconcileView(conn: DbConnection, view: ViewName): void {
  const source = VIEW_SOURCES[view];
  replaceRows(
    viewRows[view] as Map<string, unknown>,
    source.rows(conn.db),
    source.keyOf as (row: unknown) => string,
  );
}

function replaceRows<Row>(
  target: Map<string, Row>,
  rows: Iterable<Row>,
  keyOf: (row: Row) => string,
): void {
  target.clear();
  for (const row of rows) {
    target.set(keyOf(row), row);
  }
}

/** Register cache-event handlers that mark a view dirty on any change batch. */
function watchView(conn: DbConnection, view: ViewName): void {
  const table = conn.db[view] as {
    onInsert: (cb: () => void) => void;
    onDelete: (cb: () => void) => void;
    onUpdate?: (cb: () => void) => void;
  };
  table.onInsert(() => markDirty(view));
  table.onDelete(() => markDirty(view));
  table.onUpdate?.(() => markDirty(view));
}

const ALL_VIEWS: readonly ViewName[] = [
  "myTournaments",
  "sessionState",
  "currentOrganizer",
  "organizerTournament",
  "organizerParticipants",
  "organizerMatches",
  "organizerResults",
  "sharedTournament",
  "sharedParticipants",
  "sharedMatches",
  "sharedResults",
  "suggestDisciplines",
];

// ---------------------------------------------------------------------------
// Contract row identity: what pages are handed, kept stable per row
// ---------------------------------------------------------------------------

/**
 * An identity cache for contract rows, keyed by id. Reconciling a fresh
 * row set returns the rows in order, reusing the previous object for a
 * row whose fields are all unchanged and adopting the fresh object for
 * a row that changed — the delivery shape of the Convex client, whose
 * cache hands back the same object for an unchanged row and a new one
 * for a changed row, with plain (untracked) field reads throughout.
 *
 * The trial's adapter kept these rows in Solid stores instead, and the
 * live gate at app scale (PR-C) showed why that cannot stand: a store
 * row's field reads are reactive sources, so a consumer memo that maps
 * over the rows (the bracket's participant-name join) tracks one source
 * per field per row and crosses the gate's scope-width threshold at
 * sixteen participants, where the Convex client's plain rows track
 * only the array. Field-stable store nodes were the trial's answer to
 * wholesale replacement tripping IMMUTABLE_UPDATE_IN_STORE; identity
 * caching gets the same list stability — an unchanged row keeps its
 * object, so keyed lists do not churn — without putting a store
 * between the pages and the data.
 */
interface IdentityCache<Row extends object> {
  reconcile(rows: readonly Row[], keyOf: (row: Row) => string): Row[];
  clear(): void;
}

function shallowEqualRow<Row extends object>(a: Row, b: Row): boolean {
  const aKeys = Object.keys(a) as (keyof Row)[];
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => Object.is(a[key], b[key]));
}

function createIdentityCache<Row extends object>(
  equalRow: (a: Row, b: Row) => boolean = shallowEqualRow,
): IdentityCache<Row> {
  let cached = new Map<string, Row>();
  return {
    reconcile(rows, keyOf) {
      const next = new Map<string, Row>();
      const delivered = rows.map((row) => {
        const key = keyOf(row);
        const previous = cached.get(key);
        const kept = previous !== undefined && equalRow(previous, row) ? previous : row;
        next.set(key, kept);
        return kept;
      });
      cached = next;
      return delivered;
    },
    clear() {
      cached = new Map();
    },
  };
}

/** The my_tournaments summaries, in the cache the list is rendered from. */
const summaryCache = createIdentityCache<TournamentSummary>(
  (a, b) =>
    a.name === b.name &&
    a.status === b.status &&
    a.discipline === b.discipline &&
    a.shareSlug === b.shareSlug &&
    a.format.family === b.format.family &&
    (a.format.family !== "double_elimination" ||
      (b.format.family === "double_elimination" &&
        a.format.grandFinalReset === b.format.grandFinalReset)),
);

/** The current organizer scope's participant rows, keyed by participant id. */
const organizerParticipantCache = createIdentityCache<ParticipantView>();
/** The current shared scope's participant rows, keyed by participant id. */
const sharedParticipantCache = createIdentityCache<ParticipantView>();

// ---------------------------------------------------------------------------
// Channels: one per (operation, arguments) the seam subscribes
// ---------------------------------------------------------------------------

interface ChannelListener {
  onValue: (value: unknown) => void;
  onError: (error: unknown) => void;
}

interface Channel {
  key: string;
  listeners: Set<ChannelListener>;
  hasValue: boolean;
  value: unknown;
  fingerprint: string;
  /** Recompute from current view state; undefined while not ready. */
  compute: () => unknown;
  ready: () => boolean;
  /** The views whose changes should recompute this channel. */
  inputs: readonly ViewName[];
  /** Release the underlying subscriptions when the last listener goes. */
  release: () => void;
  /** Rebind the underlying subscription (scope channels, on re-subscribe). */
  ensure?: () => void;
  scopeKind?: "organizer" | "shared";
  scopeKey?: string;
}

const channels = new Map<string, Channel>();

function deliver(channel: Channel): void {
  if (!channel.ready()) return;
  let value: unknown;
  try {
    value = channel.compute();
  } catch (error) {
    for (const listener of channel.listeners) listener.onError(error);
    return;
  }
  const fingerprint = JSON.stringify(value) ?? "";
  if (channel.hasValue && fingerprint === channel.fingerprint) return;
  channel.hasValue = true;
  channel.value = value;
  channel.fingerprint = fingerprint;
  for (const listener of channel.listeners) listener.onValue(value);
}

function refreshChannels(dirty: ReadonlySet<ViewName>): void {
  for (const channel of channels.values()) {
    if (channel.listeners.size === 0) continue;
    if (channel.inputs.some((view) => dirty.has(view))) deliver(channel);
  }
}

const HOLD_MS = 10_000;

function subscribeChannel(
  channel: Channel,
  onValue: (value: unknown) => void,
  onError: (error: unknown) => void,
): () => void {
  channel.ensure?.();
  const listener: ChannelListener = {
    onValue: (value) => onValue(value),
    onError,
  };
  channel.listeners.add(listener);
  if (channel.hasValue) {
    // A warm channel answers a new subscriber from what it holds,
    // as the Convex client answered from its cache; the deliver
    // below then catches it (and everyone) up if the held value is
    // behind the current state.
    onValue(channel.value);
  }
  deliver(channel);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    channel.listeners.delete(listener);
    if (channel.listeners.size === 0) {
      // The Convex prefetch hold, applied to every seam release: a
      // subscription dropped on navigation is kept for a grace
      // period, so coming straight back finds it warm.
      setTimeout(() => {
        if (channel.listeners.size === 0) {
          channels.delete(channel.key);
          channel.release();
        }
      }, HOLD_MS);
    }
  };
}

// ---------------------------------------------------------------------------
// System feeds: held for the connection's whole life once built
// ---------------------------------------------------------------------------

let systemApplied = false;
let systemHandle: { unsubscribe: () => void } | undefined;
const watchedConnections = new WeakSet<DbConnection>();

/** Scopes requested before the connection existed (or dropped by an identity reset) start here. */
function startPendingScopes(): void {
  for (const scope of [scopes.organizer, scopes.shared]) {
    if (scope !== undefined && !scope.started && !scopeDraining[scope.kind]) {
      startScope(scope);
    }
  }
}

function resubscribeSuggests(): void {
  if (!suggestResubscribe) return;
  suggestResubscribe = false;
  for (const channel of channels.values()) {
    if (channel.key.startsWith("suggestDisciplines:")) {
      subscribeSuggest(channel.key.slice("suggestDisciplines:".length), channel);
    }
  }
}

function onConnected(conn: DbConnection): void {
  if (!watchedConnections.has(conn)) {
    watchedConnections.add(conn);
    for (const view of ALL_VIEWS) watchView(conn, view);
  }
  startPendingScopes();
  resubscribeSuggests();
  if (systemHandle !== undefined) return;
  systemHandle = conn
    .subscriptionBuilder()
    .onApplied(() => {
      systemApplied = true;
      for (const view of ["myTournaments", "sessionState", "currentOrganizer"] as const) {
        markDirty(view);
      }
    })
    .onError((ctx) => {
      const error = ctx.event ?? new Error("Subscription failed");
      for (const channel of channels.values()) {
        if (channel.inputs.some((view) => SYSTEM_VIEWS.includes(view))) {
          for (const listener of channel.listeners) listener.onError(error);
        }
      }
    })
    .subscribe([
      "SELECT * FROM my_tournaments",
      "SELECT * FROM session_state",
      "SELECT * FROM current_organizer",
    ]);
}

const SYSTEM_VIEWS: readonly ViewName[] = ["myTournaments", "sessionState", "currentOrganizer"];

// ---------------------------------------------------------------------------
// Scopes: one tournament (or one slug) at a time per surface family
// ---------------------------------------------------------------------------

interface Scope {
  kind: "organizer" | "shared";
  key: string;
  handle: { unsubscribeThen: (cb: () => void) => void; unsubscribe: () => void } | undefined;
  applied: boolean;
  /** True once the subscription has actually been started (a scope
   * created behind a pending drain, or before the connection
   * exists, has not). */
  started: boolean;
  /** Channels waiting on or reading this scope. */
  channels: Set<Channel>;
}

/** A drain (the previous scope's rows leaving the caches) is in flight, per family. */
const scopeDraining: Record<"organizer" | "shared", boolean> = {
  organizer: false,
  shared: false,
};

const scopes: Record<"organizer" | "shared", Scope | undefined> = {
  organizer: undefined,
  shared: undefined,
};

const ORGANIZER_VIEWS: readonly ViewName[] = [
  "organizerTournament",
  "organizerParticipants",
  "organizerMatches",
  "organizerResults",
];
const SHARED_VIEWS: readonly ViewName[] = [
  "sharedTournament",
  "sharedParticipants",
  "sharedMatches",
  "sharedResults",
];

function scopeQueries(scope: Scope): string[] {
  if (scope.kind === "organizer") {
    const id = scope.key;
    return [
      `SELECT * FROM organizer_tournament(${id})`,
      `SELECT * FROM organizer_participants(${id})`,
      `SELECT * FROM organizer_matches(${id})`,
      `SELECT * FROM organizer_results(${id})`,
    ];
  }
  const slug = `'${scope.key.replaceAll("'", "''")}'`;
  return [
    `SELECT * FROM shared_tournament(${slug})`,
    `SELECT * FROM shared_participants(${slug})`,
    `SELECT * FROM shared_matches(${slug})`,
    `SELECT * FROM shared_results(${slug})`,
  ];
}

function startScope(scope: Scope): void {
  if (live === undefined) return;
  const conn = live.conn;
  scope.started = true;
  scope.handle = conn
    .subscriptionBuilder()
    .onApplied(() => {
      scope.applied = true;
      for (const view of scope.kind === "organizer" ? ORGANIZER_VIEWS : SHARED_VIEWS) {
        markDirty(view);
      }
    })
    .onError((ctx) => {
      const error = ctx.event ?? new Error("Subscription failed");
      for (const channel of scope.channels) {
        for (const listener of channel.listeners) listener.onError(error);
      }
    })
    .subscribe(scopeQueries(scope));
}

/**
 * Make `key` the current scope of its family, draining the previous
 * scope's rows out of the merged caches first: until the old
 * subscription's rows are gone, the caches would hold two
 * tournaments' rows side by side with nothing to tell them apart.
 */
function ensureScope(kind: "organizer" | "shared", key: string): Scope {
  const current = scopes[kind];
  if (current !== undefined && current.key === key) return current;
  const next: Scope = {
    kind,
    key,
    handle: undefined,
    applied: false,
    started: false,
    channels: new Set(),
  };
  scopes[kind] = next;
  if (current !== undefined && current.started && current.handle !== undefined) {
    // Drain the old scope's rows before the new subscription
    // starts. A second switch while this drain is in flight simply
    // replaces `next` as the current scope: the completion below
    // starts whichever scope is current then, and only that one.
    scopeDraining[kind] = true;
    const views = kind === "organizer" ? ORGANIZER_VIEWS : SHARED_VIEWS;
    const draining = current.handle;
    current.handle = undefined;
    draining.unsubscribeThen(() => {
      scopeDraining[kind] = false;
      for (const view of views) {
        viewRows[view].clear();
        markDirty(view);
      }
      const pending = scopes[kind];
      if (pending !== undefined && !pending.started) startScope(pending);
    });
  } else if (!scopeDraining[kind]) {
    startScope(next);
  }
  // Otherwise a drain from an earlier switch is still in flight;
  // its completion starts the now-current scope (this one).
  return next;
}

function scopeReady(scope: Scope): boolean {
  // Applied implies drained: a scope's subscription only starts
  // once the previous scope's rows have left the caches (see
  // ensureScope), so its applied row set is exactly its own.
  return scopes[scope.kind] === scope && scope.applied;
}

function releaseScope(scope: Scope): void {
  const isCurrent = scopes[scope.kind] === scope;
  if (isCurrent) {
    scopes[scope.kind] = undefined;
  }
  scope.handle?.unsubscribe();
  scope.handle = undefined;
  if (!isCurrent) {
    // A superseded scope: its rows were drained at the switch, and
    // the family's shared state now belongs to the live scope —
    // clearing it here would blank the page the user is looking at.
    return;
  }
  for (const view of scope.kind === "organizer" ? ORGANIZER_VIEWS : SHARED_VIEWS) {
    viewRows[view].clear();
  }
  if (scope.kind === "organizer") {
    organizerParticipantCache.clear();
    evictKnowledge(scope.key);
  } else {
    sharedParticipantCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Read channels per operation
// ---------------------------------------------------------------------------

/** Latest composed knowledge per tournament, for write-result synthesis. */
const knowledgeByTournament = new Map<string, TournamentKnowledge>();
const matchHome = new Map<string, string>();

/** The released tournament's knowledge goes with its scope: synthesis must not keep reading from a surface the client no longer holds. */
function evictKnowledge(tournamentId: string): void {
  knowledgeByTournament.delete(tournamentId);
  for (const [id, home] of matchHome) {
    if (home === tournamentId) matchHome.delete(id);
  }
}

/** Record a composed knowledge as the tournament's current one, rebuilding its match home index (stale homes go first: a removed row must not keep pointing here). */
function registerKnowledge(tournamentId: string, knowledge: TournamentKnowledge): void {
  knowledgeByTournament.set(tournamentId, knowledge);
  for (const [id, home] of matchHome) {
    if (home === tournamentId) matchHome.delete(id);
  }
  for (const id of knowledge.matchKeyById.keys()) {
    matchHome.set(id, tournamentId);
  }
}

/** The organizer composition over the tier-1 rows as they stand. */
function composeHeldOrganizer(): OrganizerComposition {
  return composeOrganizerTournament({
    header: viewRows.organizerTournament.get("header"),
    participants: [...viewRows.organizerParticipants.values()],
    matches: [...viewRows.organizerMatches.values()],
    results: [...viewRows.organizerResults.values()],
  });
}

/**
 * One tournament's knowledge, composed on demand from the tier-1
 * rows when its scope is the held one — result synthesis reads
 * knowledge through here, never only from
 * the organizer channel's last delivery: the channel computes (and
 * so refreshes the maps) only while it has listeners, and a write
 * must not depend on a read subscription staying alive beside it.
 * Falls back to the last composed knowledge when the scope is not
 * held (or its rows have not applied yet).
 */
function currentKnowledge(tournamentId: string): TournamentKnowledge | undefined {
  const scope = scopes.organizer;
  if (scope === undefined || scope.key !== tournamentId || !scope.applied) {
    return knowledgeByTournament.get(tournamentId);
  }
  const { knowledge } = composeHeldOrganizer();
  if (knowledge === null) return knowledgeByTournament.get(tournamentId);
  registerKnowledge(tournamentId, knowledge);
  return knowledge;
}

/**
 * Compose the held scope's knowledge afresh, so the home index and
 * the before-state a write's snapshots read are current: the
 * organizer channel maintains them only while it has listeners,
 * and a write must not depend on a read subscription staying alive
 * beside it.
 */
function refreshHeldKnowledge(): void {
  const scope = scopes.organizer;
  if (scope !== undefined) currentKnowledge(scope.key);
}

/**
 * A channel backed by one of the exclusive scopes (organizer or
 * shared): the scope is rebound on every subscribe, since another
 * page may have taken the family's scope (and drained this one's
 * rows) while this channel was idle.
 */
function scopedChannel(
  kind: "organizer" | "shared",
  key: string,
  scopeKey: string,
  inputs: readonly ViewName[],
  compute: () => unknown,
): Channel {
  const existing = channels.get(key);
  if (existing !== undefined) return existing;
  let scope = ensureScope(kind, scopeKey);
  const channel: Channel = {
    key,
    listeners: new Set(),
    hasValue: false,
    value: undefined,
    fingerprint: "",
    inputs,
    scopeKind: kind,
    scopeKey,
    ensure: () => {
      scope = ensureScope(kind, scopeKey);
      scope.channels.add(channel);
    },
    ready: () => scopeReady(scope),
    compute,
    release: () => releaseScope(scope),
  };
  scope.channels.add(channel);
  channels.set(key, channel);
  return channel;
}

function organizerChannel(tournamentId: string): Channel {
  return scopedChannel(
    "organizer",
    `organizerTournament:${tournamentId}`,
    tournamentId,
    ORGANIZER_VIEWS,
    () => {
      const { view, knowledge } = composeHeldOrganizer();
      if (knowledge !== null) registerKnowledge(tournamentId, knowledge);
      const participants = organizerParticipantCache.reconcile(
        knowledge?.participants ?? [],
        (row) => row.participantId,
      );
      if (view === null) return null;
      return { ...view, participants };
    },
  );
}

function sharedChannel(slug: string): Channel {
  return scopedChannel("shared", `sharedTournament:${slug}`, slug, SHARED_VIEWS, () => {
    const view = composeSharedTournament({
      header: viewRows.sharedTournament.get("header"),
      participants: [...viewRows.sharedParticipants.values()],
      matches: [...viewRows.sharedMatches.values()],
      results: [...viewRows.sharedResults.values()],
    });
    const participants = sharedParticipantCache.reconcile(
      view?.participants ?? [],
      (row) => row.participantId,
    );
    if (view === null) return null;
    return { ...view, participants };
  });
}

function systemChannel(key: string, inputs: readonly ViewName[], compute: () => unknown): Channel {
  const existing = channels.get(key);
  if (existing !== undefined) return existing;
  const channel: Channel = {
    key,
    listeners: new Set(),
    hasValue: false,
    value: undefined,
    fingerprint: "",
    inputs,
    ready: () => systemApplied,
    compute,
    release: () => {},
  };
  channels.set(key, channel);
  return channel;
}

function myTournamentsChannel(): Channel {
  return systemChannel("myTournaments", ["myTournaments"], () => {
    return summaryCache.reconcile(
      composeMyTournaments([...viewRows.myTournaments.values()]),
      (row) => String(row.tournamentId),
    );
  });
}

function currentOrganizerChannel(): Channel {
  return systemChannel("currentOrganizer", ["currentOrganizer"], () =>
    composeCurrentOrganizer(viewRows.currentOrganizer.get("row")),
  );
}

/** Suggestion feeds: one subscription per distinct prefix; the caches merge, the filter sorts it out. */
const suggestHandles = new Map<string, { unsubscribe: () => void }>();
const suggestApplied = new Map<string, boolean>();
/** Set by an identity reset: the suggestion subscriptions died with the old connection and onConnected re-establishes them. */
let suggestResubscribe = false;

function subscribeSuggest(prefix: string, channel: Channel): void {
  void getLive()
    .then(({ conn }) => {
      if (!channels.has(channel.key)) return;
      // One subscription per prefix per connection: a channel
      // created while an identity reset's re-subscription is also
      // pending must not end up subscribed twice (the second handle
      // would shadow the first in the map and leak it).
      if (suggestHandles.has(prefix)) return;
      const literal = `'${prefix.replaceAll("'", "''")}'`;
      const handle = conn
        .subscriptionBuilder()
        .onApplied(() => {
          suggestApplied.set(prefix, true);
          markDirty("suggestDisciplines");
        })
        .onError((ctx) => {
          const error = ctx.event ?? new Error("Subscription failed");
          for (const listener of channel.listeners) listener.onError(error);
        })
        .subscribe([`SELECT * FROM suggest_disciplines(${literal})`]);
      suggestHandles.set(prefix, handle);
    })
    .catch(() => {
      // The connection failure already reaches the channel through
      // subscribeSpacetime's own getLive() catch.
    });
}

function suggestChannel(prefix: string): Channel {
  const key = `suggestDisciplines:${prefix}`;
  const existing = channels.get(key);
  if (existing !== undefined) return existing;
  const channel: Channel = {
    key,
    listeners: new Set(),
    hasValue: false,
    value: undefined,
    fingerprint: "",
    inputs: ["suggestDisciplines"],
    ready: () => suggestApplied.get(prefix) === true,
    compute: () => filterSuggestions([...viewRows.suggestDisciplines.values()], prefix),
    release: () => {
      suggestHandles.get(prefix)?.unsubscribe();
      suggestHandles.delete(prefix);
      suggestApplied.delete(prefix);
    },
  };
  channels.set(key, channel);
  subscribeSuggest(prefix, channel);
  return channel;
}

const U64_ARG = /^\d+$/;

function subscribeSpacetime<Args, Result>(
  op: ReadOp<Args, Result>,
  args: Args,
  onValue: (value: Result) => void,
  onError: (error: unknown) => void,
): () => void {
  const reportError = onError;
  void (async () => {
    try {
      await getLive();
    } catch (error) {
      reportError(error);
    }
  })();
  switch (op.spacetime) {
    case "myTournaments":
      return subscribeChannel(myTournamentsChannel(), onValue as never, onError);
    case "currentOrganizer":
      return subscribeChannel(currentOrganizerChannel(), onValue as never, onError);
    case "organizerTournament": {
      const { tournamentId } = args as { tournamentId: string };
      if (!U64_ARG.test(tournamentId)) {
        // An id the module could never have issued: the surface's
        // answer is the same as a missing tournament's — nothing.
        onValue(null as Result);
        return () => {};
      }
      return subscribeChannel(organizerChannel(tournamentId), onValue as never, onError);
    }
    case "sharedTournament": {
      const { shareSlug } = args as { shareSlug: string };
      return subscribeChannel(sharedChannel(shareSlug), onValue as never, onError);
    }
    case "suggestDisciplines": {
      const { prefix } = args as { prefix: string };
      return subscribeChannel(suggestChannel(prefix), onValue as never, onError);
    }
  }
}

// ---------------------------------------------------------------------------
// Prefetch: warm a read ahead of its page (the seam's contract)
// ---------------------------------------------------------------------------

function prefetchSpacetime<Args>(op: ReadOp<Args, unknown>, args: Args): void {
  switch (op.spacetime) {
    case "myTournaments":
    case "currentOrganizer":
      // System feeds are held for the connection's life; warming is
      // just making sure the connection exists.
      void getLive().catch(() => {});
      return;
    case "organizerTournament": {
      const { tournamentId } = args as { tournamentId: string };
      if (!U64_ARG.test(tournamentId)) return;
      prefetchScope(organizerChannel(tournamentId));
      return;
    }
    case "sharedTournament": {
      const { shareSlug } = args as { shareSlug: string };
      prefetchScope(sharedChannel(shareSlug));
      return;
    }
    case "suggestDisciplines": {
      const { prefix } = args as { prefix: string };
      const channel = suggestChannel(prefix);
      const release = subscribeChannel(
        channel,
        () => {},
        () => {},
      );
      setTimeout(release, HOLD_MS);
      return;
    }
  }
}

/**
 * Hold a scope channel open for the prefetch grace period — unless
 * another scope of the same family is live for a page, in which case
 * warming this one would drain the page's rows out of the merged
 * caches and the warm-up is skipped (a prefetch is an optimization;
 * the page's correctness is not).
 */
function prefetchScope(channel: Channel): void {
  const kind = channel.scopeKind!;
  const current = scopes[kind];
  if (
    current !== undefined &&
    current.key !== channel.scopeKey &&
    [...current.channels].some((held) => held.listeners.size > 0)
  ) {
    return;
  }
  const release = subscribeChannel(
    channel,
    () => {},
    () => {},
  );
  setTimeout(release, HOLD_MS);
}

// ---------------------------------------------------------------------------
// Writes: call the reducer, surface its refusal, synthesize the return
// ---------------------------------------------------------------------------

const SYNTHESIS_TIMEOUT_MS = 2_000;
const SYNTHESIS_POLL_MS = 20;

async function waitForSynthesis<T>(probe: () => T | undefined): Promise<T> {
  const deadline = Date.now() + SYNTHESIS_TIMEOUT_MS;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(GENERIC_WRITE_ERROR);
    await new Promise((resolve) => setTimeout(resolve, SYNTHESIS_POLL_MS));
  }
}

function idArg(value: string): bigint {
  if (!U64_ARG.test(value)) throw new Error(GENERIC_WRITE_ERROR);
  return BigInt(value);
}

type Reducers = DbConnection["reducers"];

/** The reducer dispatch table: contract arguments in, the module's call out. */
const REDUCER_CALLS: Record<
  string,
  (reducers: Reducers, args: Record<string, unknown>) => Promise<void>
> = {
  async createTournament(reducers, args) {
    const a = args as unknown as CreateTournamentArgs;
    await reducers.createTournament({
      name: a.name,
      discipline: a.discipline,
      format: formatArgToBinding(a.format),
    });
  },
  async updateTournament(reducers, args) {
    const a = args as unknown as UpdateTournamentArgs;
    await reducers.updateTournament({
      tournamentId: idArg(a.tournamentId),
      name: a.name,
      discipline: a.discipline,
      format: a.format === undefined ? undefined : formatArgToBinding(a.format),
    });
  },
  async deleteTournament(reducers, args) {
    await reducers.deleteTournament({ tournamentId: idArg(args.tournamentId as string) });
  },
  async addParticipant(reducers, args) {
    await reducers.addParticipant({
      tournamentId: idArg(args.tournamentId as string),
      name: args.name as string,
    });
  },
  async addParticipants(reducers, args) {
    await reducers.addParticipants({
      tournamentId: idArg(args.tournamentId as string),
      text: args.text as string,
    });
  },
  async renameParticipant(reducers, args) {
    await reducers.renameParticipant({
      participantId: idArg(args.participantId as string),
      name: args.name as string,
    });
  },
  async removeParticipant(reducers, args) {
    await reducers.removeParticipant({ participantId: idArg(args.participantId as string) });
  },
  async reorderSeeding(reducers, args) {
    await reducers.reorderSeeding({
      tournamentId: idArg(args.tournamentId as string),
      orderedParticipantIds: (args.orderedParticipantIds as string[]).map(idArg),
    });
  },
  async generateBracket(reducers, args) {
    await reducers.generateBracket({ tournamentId: idArg(args.tournamentId as string) });
  },
  async publishTournament(reducers, args) {
    await reducers.publishTournament({ tournamentId: idArg(args.tournamentId as string) });
  },
  async reportResult(reducers, args) {
    const a = args as unknown as ReportResultArgs;
    await reducers.reportResult({
      matchId: idArg(a.matchId),
      sides: a.sides.map((side) => ({
        participantId: idArg(side.participantId),
        outcome: outcomeToBinding(side.outcome),
        score: side.score,
      })),
    });
  },
};

async function callReducer(
  conn: DbConnection,
  opKey: string,
  args: Record<string, unknown>,
): Promise<void> {
  const call = REDUCER_CALLS[opKey];
  if (call === undefined) throw new Error(GENERIC_WRITE_ERROR);
  await call(conn.reducers, args);
}

/** What a write's return is read back from, snapshotted before the call. */
interface WriteSnapshots {
  beforeSummaryIds: ReadonlySet<string>;
  tournamentId: string | undefined;
  beforeParticipantIds: ReadonlySet<string>;
  reportHome: string | undefined;
  beforeReport: TournamentKnowledge | undefined;
}

function snapshotWrite(record: Record<string, unknown>): WriteSnapshots {
  const tournamentId = typeof record.tournamentId === "string" ? record.tournamentId : undefined;
  const beforeKnowledge = tournamentId !== undefined ? currentKnowledge(tournamentId) : undefined;
  // reportResult's arguments carry no tournamentId: its home is
  // resolved through the match, and its before-knowledge must be
  // snapshotted here too — after the call, the subscription may
  // already have delivered the new record, and a "before" read then
  // would make the synthesis wait for a second record that never
  // comes.
  const reportHome = typeof record.matchId === "string" ? matchHome.get(record.matchId) : undefined;
  return {
    beforeSummaryIds: new Set(viewRows.myTournaments.keys()),
    tournamentId,
    beforeParticipantIds: new Set(
      (beforeKnowledge?.participants ?? []).map((p) => p.participantId),
    ),
    reportHome,
    beforeReport: reportHome !== undefined ? currentKnowledge(reportHome) : undefined,
  };
}

/** The returns the reducers do not have, read back from the subscriptions (see the model). */
async function synthesizeWriteResult<Result>(
  opKey: string,
  args: Record<string, unknown>,
  snapshots: WriteSnapshots,
): Promise<Result> {
  switch (opKey) {
    case "createTournament": {
      const a = args as unknown as CreateTournamentArgs;
      const created = await waitForSynthesis(() => {
        const summaries = composeMyTournaments([...viewRows.myTournaments.values()]);
        return (
          synthesizeCreated(snapshots.beforeSummaryIds, summaries, {
            name: a.name,
            discipline: a.discipline,
            format: a.format,
          }) ?? undefined
        );
      });
      return created as Result;
    }
    case "addParticipant": {
      const name = args.name as string;
      const id = await waitForSynthesis(() => {
        const knowledge =
          snapshots.tournamentId !== undefined
            ? currentKnowledge(snapshots.tournamentId)
            : undefined;
        if (knowledge === undefined) return undefined;
        const ids = synthesizeAddedParticipants(
          snapshots.beforeParticipantIds,
          knowledge.participants,
          [name],
        );
        return ids.length === 1 ? ids[0] : undefined;
      });
      return id as Result;
    }
    case "addParticipants": {
      const names = parseBulkNames(args.text as string);
      const ids = await waitForSynthesis(() => {
        const knowledge =
          snapshots.tournamentId !== undefined
            ? currentKnowledge(snapshots.tournamentId)
            : undefined;
        if (knowledge === undefined) return undefined;
        const ids = synthesizeAddedParticipants(
          snapshots.beforeParticipantIds,
          knowledge.participants,
          names,
        );
        return ids.length === names.length ? ids : undefined;
      });
      return ids as Result;
    }
    case "reportResult": {
      const { beforeReport: before, reportHome: home } = snapshots;
      if (before === undefined || home === undefined) {
        // The composition this return is read from is not held;
        // without it there is no honest value to hand back.
        throw new Error(GENERIC_WRITE_ERROR);
      }
      const report = await waitForSynthesis(() => {
        const after = currentKnowledge(home);
        // At least this call's record: a concurrent report from
        // another tab may have landed in the same window (the
        // voided diff is by result id against the before-snapshot,
        // so an overshoot still reads correctly).
        if (after === undefined || after.resultCount < before.resultCount + 1) {
          return undefined;
        }
        return synthesizeReport(before, after);
      });
      return report as Result;
    }
    default:
      return null as Result;
  }
}

async function writeSpacetime<Args, Result>(
  op: WriteOp<Args, Result>,
  args: Args,
): Promise<Result> {
  const { conn } = await getLive();
  const record = args as Record<string, unknown>;
  refreshHeldKnowledge();
  const snapshots = snapshotWrite(record);
  try {
    await callReducer(conn, op.spacetime, record);
  } catch (error) {
    // The module's deliberate refusals arrive as a SenderError
    // carrying the guard's own text — that text is the failure the
    // page prints. Anything else (an InternalError host fault, a
    // transport failure) is the one generic message.
    if (error instanceof SenderError) throw new Error(error.message);
    throw new Error(GENERIC_WRITE_ERROR);
  }
  return synthesizeWriteResult(op.spacetime, record, snapshots);
}

function outcomeToBinding(outcome: Outcome): { tag: (typeof OUTCOME_TO_BINDING)[Outcome] } {
  return { tag: OUTCOME_TO_BINDING[outcome] };
}

// ---------------------------------------------------------------------------
// The implementation behind the seam
// ---------------------------------------------------------------------------

/**
 * The seam's SpacetimeDB implementation: subscribe / write /
 * prefetch, in `./backend`'s BackendImpl shape.
 *
 * @public
 */
export const spacetimeImpl = {
  subscribe: subscribeSpacetime,
  write: writeSpacetime,
  prefetch: prefetchSpacetime,
};

// ---------------------------------------------------------------------------
// Session access for `./auth`'s SpacetimeDB implementation
// ---------------------------------------------------------------------------

const sessionListeners = new Set<(state: SessionState) => void>();

function currentSessionState(): SessionState {
  const row = viewRows.sessionState.get("state");
  return row === undefined ? { kind: "unauthenticated" } : composeSessionState(row);
}

function refreshSessionListeners(): void {
  if (!systemApplied) return;
  const state = currentSessionState();
  for (const listener of sessionListeners) listener(state);
}

/**
 * The session state as the module's session_state view reports it,
 * delivered on every change; the first delivery waits for the feed
 * to apply.
 *
 * @public
 */
export function onSpacetimeSession(listener: (state: SessionState) => void): () => void {
  sessionListeners.add(listener);
  if (systemApplied) listener(currentSessionState());
  return () => {
    sessionListeners.delete(listener);
  };
}

/**
 * A promise for the first session state matching the predicate,
 * bounded at ten seconds: a feed that never applies (a wrong
 * database name, a missing module) is a broken backend, and the
 * caller must hear about it rather than wait forever.
 *
 * @public
 */
export function waitForSpacetimeSession(
  predicate: (state: SessionState) => boolean,
  timeoutMessage: string,
): Promise<SessionState> {
  const deadline = Date.now() + 10_000;
  return new Promise((resolve, reject) => {
    // The listener can fire synchronously out of onSpacetimeSession
    // (the feed already applied) — before the unsubscribe handle
    // and the interval exist. The finish gate tolerates both: it
    // runs at most once, and a registration-time firing is
    // unsubscribed right after registration returns the handle.
    let timer: ReturnType<typeof setInterval> | undefined;
    let stop: (() => void) | undefined;
    let done = false;
    const finish = (settle: () => void): void => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearInterval(timer);
      stop?.();
      settle();
    };
    stop = onSpacetimeSession((state) => {
      if (predicate(state)) finish(() => resolve(state));
    });
    if (done) {
      stop();
      return;
    }
    timer = setInterval(() => {
      if (Date.now() > deadline) {
        finish(() => reject(new Error(timeoutMessage)));
      }
    }, 100);
  });
}

/**
 * A promise for the first applied session state, whatever it is.
 *
 * @public
 */
export async function whenSpacetimeSessionReady(): Promise<SessionState> {
  if (systemApplied) return currentSessionState();
  return waitForSpacetimeSession(
    () => true,
    "The session could not be established. Please try again.",
  );
}

/**
 * Bind the connection's identity to its app_user (the module's
 * explicit bind; every reducer would also bind on first use).
 *
 * @public
 */
export async function bindSpacetimeIdentity(): Promise<void> {
  const { conn } = await getLive();
  await conn.reducers.bindIdentity({});
}

/**
 * Drop the stored identity and rebuild the connection: the remedy
 * for a binding whose app_user row is gone (session user_missing) —
 * the dead identity can never act again, so the client starts over
 * tokenless and the server mints a fresh one, as a Convex sign-out
 * and fresh anonymous sign-in did. Live subscriptions are
 * re-established on the new connection (system feeds and the current
 * scopes); channels keep their last values until the new feeds
 * apply.
 *
 * @public
 */
export async function resetSpacetimeIdentity(): Promise<void> {
  const config = getSpacetimeConfig();
  if (config === undefined) return;
  const old = live;
  live = undefined;
  livePromise = undefined;
  systemApplied = false;
  systemHandle = undefined;
  clearStoredToken(config);
  old?.conn.disconnect();
  for (const view of ALL_VIEWS) viewRows[view].clear();
  knowledgeByTournament.clear();
  matchHome.clear();
  suggestHandles.clear();
  suggestApplied.clear();
  suggestResubscribe = true;
  scopeDraining.organizer = false;
  scopeDraining.shared = false;
  for (const scope of [scopes.organizer, scopes.shared]) {
    if (scope !== undefined) {
      scope.handle = undefined;
      scope.applied = false;
      scope.started = false;
    }
  }
  // The new connection's onConnect re-subscribes the system feeds
  // and restarts the scopes (onConnected).
  await getLive();
}
