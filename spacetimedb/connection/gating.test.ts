/**
 * Connection-level gating proofs (migration plan §4 M2, PR-C): the
 * wire-level half of the parity claim the harness port cannot make.
 * The harness (spacetimedb/test/) asserts sender-gating LOGIC through
 * JWT-derived senders; this suite asserts what real clients actually
 * RECEIVE — a real standalone (see global-setup.ts), the committed
 * module published from the committed sources, real subscriptions
 * through the committed bindings, and tokenless connections, so every
 * identity here is server-minted.
 *
 *   1. Positive control: an organizer receives its own surfaces in
 *      full — without it, every "receives nothing" below is vacuous.
 *   2. A foreign organizer receives nothing from another's surfaces.
 *   3. A never-bound (anonymous) identity receives nothing from the
 *      private surfaces, and its session reads unauthenticated.
 *   4. A private base table rejects a subscription outright.
 *   5. The share views deliver exactly the published surface — the
 *      shared-audience fields only — and live updates flow; draft and
 *      unknown slugs deliver nothing.
 *   6. A reducer call across the ownership boundary is refused on
 *      the wire with no effect on the owner's data, and a reducer
 *      that fails after writing rolls the whole transaction back
 *      (the wire does not carry the module's error message — see
 *      those tests).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DbConnection } from "../bindings";

const { port, database } = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", ".connection-build", "server.json"),
    "utf8",
  ),
) as { port: number; database: string };
const URI = `ws://127.0.0.1:${port}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(database)
      .onConnect((conn) => resolve(conn))
      .onConnectError((_ctx, error) => reject(error))
      .build();
  });
}

function subscribe(conn: DbConnection, queries: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject(ctx.event ?? new Error("subscription failed")))
      .subscribe(queries);
  });
}

function subscribeError(conn: DbConnection, queries: string[]): Promise<Error> {
  return new Promise((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => reject(new Error("subscription unexpectedly applied")))
      .onError((ctx) => resolve(ctx.event ?? new Error("subscription failed")))
      .subscribe(queries);
  });
}

// Subscriptions are eventually consistent: a cache assertion is only
// meaningful once the rows it waits for have had their chance to
// arrive (positive waits), or once the subscription is applied and a
// settle window has passed (negative assertions).
async function waitFor(label: string, probe: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (probe()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for: ${label}`);
    }
    await sleep(50);
  }
}

const rowsOf = <Row>(iterable: Iterable<Row>): Row[] => [...iterable];
const keysOf = (row: object): string[] => Object.keys(row).sort();

describe("connection-level gating", () => {
  let connA: DbConnection;
  let connB: DbConnection;
  let connAnon: DbConnection;
  let connShare: DbConnection;
  let wireId = 0n;
  let wireSlug = "";
  let draftSlug = "";

  beforeAll(async () => {
    connA = await connect();
    connB = await connect();
    connAnon = await connect();
    connShare = await connect();

    // Organizer A builds the published tournament the suite probes,
    // driving the real reducers over the wire.
    await connA.reducers.bindIdentity({});
    await subscribe(connA, ["SELECT * FROM my_tournaments"]);
    await connA.reducers.createTournament({
      name: "Wire Cup",
      discipline: "Wire Discipline",
      format: { tag: "SingleElimination" },
    });
    await waitFor(
      "A's tournament listed",
      () => rowsOf(connA.db.myTournaments.iter()).length === 1,
    );
    const wire = rowsOf(connA.db.myTournaments.iter())[0]!;
    wireId = wire.tournamentId;
    wireSlug = wire.shareSlug;
    await connA.reducers.addParticipants({ tournamentId: wireId, text: "P1\nP2\nP3\nP4" });
    await connA.reducers.generateBracket({ tournamentId: wireId });
    await connA.reducers.publishTournament({ tournamentId: wireId });
    // A second tournament, never published: its slug must stay dark.
    await connA.reducers.createTournament({
      name: "Draft Cup",
      discipline: "Wire Discipline",
      format: { tag: "SingleElimination" },
    });
    await waitFor("A's draft listed", () => rowsOf(connA.db.myTournaments.iter()).length === 2);
    draftSlug = rowsOf(connA.db.myTournaments.iter()).find(
      (row) => row.name === "Draft Cup",
    )!.shareSlug;

    // Organizer B, with a tournament of its own (the positive control
    // that makes B's empty foreign caches meaningful).
    await connB.reducers.bindIdentity({});
    await subscribe(connB, ["SELECT * FROM my_tournaments"]);
    await connB.reducers.createTournament({
      name: "B Cup",
      discipline: "Wire Discipline",
      format: { tag: "SingleElimination" },
    });
    await waitFor(
      "B's tournament listed",
      () => rowsOf(connB.db.myTournaments.iter()).length === 1,
    );

    // A's own organizer surfaces, subscribed once and shared by the
    // tests below.
    await subscribe(connA, [
      `SELECT * FROM organizer_tournament(${wireId})`,
      `SELECT * FROM organizer_participants(${wireId})`,
      `SELECT * FROM organizer_matches(${wireId})`,
      `SELECT * FROM organizer_results(${wireId})`,
    ]);
    await waitFor(
      "A's bracket delivered",
      () => rowsOf(connA.db.organizerMatches.iter()).length === 3,
    );

    // Both organizers' session surfaces — the positive control for
    // the current_organizer / session_state legs of the anonymous
    // test below: a bound caller DOES receive these rows.
    await subscribe(connA, ["SELECT * FROM session_state", "SELECT * FROM current_organizer"]);
    await subscribe(connB, ["SELECT * FROM session_state", "SELECT * FROM current_organizer"]);
    await waitFor(
      "both organizers' sessions delivered",
      () =>
        rowsOf(connA.db.currentOrganizer.iter()).length === 1 &&
        rowsOf(connB.db.currentOrganizer.iter()).length === 1,
    );
  });

  afterAll(() => {
    for (const conn of [connA, connB, connAnon, connShare]) {
      try {
        conn?.disconnect();
      } catch {
        // Already gone — teardown must not fail on it.
      }
    }
  });

  test("positive control: an organizer receives its own surfaces in full", () => {
    const header = rowsOf(connA.db.organizerTournament.iter());
    expect(header.length).toBe(1);
    expect(header[0]!.name).toBe("Wire Cup");
    expect(keysOf(header[0]!)).toEqual([
      "discipline",
      "format",
      "name",
      "seeding",
      "shareSlug",
      "status",
      "tournamentId",
    ]);
    expect(rowsOf(connA.db.organizerParticipants.iter()).length).toBe(4);
    expect(rowsOf(connA.db.organizerMatches.iter()).length).toBe(3);
    expect(rowsOf(connA.db.organizerResults.iter()).length).toBe(0);
    // A's own list holds both its tournaments and nothing else's.
    // (The client cache iterates in arrival order; the newest-first
    // ordering of the composed read is the composition's sort,
    // asserted in the harness suite.)
    expect(
      rowsOf(connA.db.myTournaments.iter())
        .map((row) => row.name)
        .sort(),
    ).toEqual(["Draft Cup", "Wire Cup"]);
    expect(rowsOf(connB.db.myTournaments.iter()).map((row) => row.name)).toEqual(["B Cup"]);
    // The session surfaces answer both bound organizers — the rows
    // the anonymous test below is denied are really deliverable.
    for (const conn of [connA, connB]) {
      expect(rowsOf(conn.db.currentOrganizer.iter()).length).toBe(1);
      const session = rowsOf(conn.db.sessionState.iter());
      expect(session.length).toBe(1);
      expect(session[0]!.state.tag).toBe("Organizer");
    }
  });

  test("a foreign organizer receives nothing from another's surfaces", async () => {
    await subscribe(connB, [
      `SELECT * FROM organizer_tournament(${wireId})`,
      `SELECT * FROM organizer_participants(${wireId})`,
      `SELECT * FROM organizer_matches(${wireId})`,
      `SELECT * FROM organizer_results(${wireId})`,
    ]);
    await sleep(500);
    expect(rowsOf(connB.db.organizerTournament.iter())).toEqual([]);
    expect(rowsOf(connB.db.organizerParticipants.iter())).toEqual([]);
    expect(rowsOf(connB.db.organizerMatches.iter())).toEqual([]);
    expect(rowsOf(connB.db.organizerResults.iter())).toEqual([]);
    // And its own list still shows only its own tournament.
    expect(rowsOf(connB.db.myTournaments.iter()).map((row) => row.name)).toEqual(["B Cup"]);
  });

  test("an anonymous identity receives nothing from the private surfaces", async () => {
    await subscribe(connAnon, [
      "SELECT * FROM my_tournaments",
      `SELECT * FROM organizer_tournament(${wireId})`,
      `SELECT * FROM organizer_participants(${wireId})`,
      `SELECT * FROM organizer_matches(${wireId})`,
      `SELECT * FROM organizer_results(${wireId})`,
      "SELECT * FROM session_state",
      "SELECT * FROM current_organizer",
    ]);
    await sleep(500);
    expect(rowsOf(connAnon.db.myTournaments.iter())).toEqual([]);
    expect(rowsOf(connAnon.db.organizerTournament.iter())).toEqual([]);
    expect(rowsOf(connAnon.db.organizerParticipants.iter())).toEqual([]);
    expect(rowsOf(connAnon.db.organizerMatches.iter())).toEqual([]);
    expect(rowsOf(connAnon.db.organizerResults.iter())).toEqual([]);
    expect(rowsOf(connAnon.db.currentOrganizer.iter())).toEqual([]);
    // The one surface that answers a never-bound caller is its own
    // session state — and it answers "unauthenticated".
    const session = rowsOf(connAnon.db.sessionState.iter());
    expect(session.length).toBe(1);
    expect(session[0]!.state.tag).toBe("Unauthenticated");
  });

  test("every private base table rejects a subscription outright", async () => {
    // All seven base tables are private in the schema; a
    // subscription to any of them must error, never apply.
    for (const table of [
      "app_user",
      "identity_user",
      "discipline",
      "tournament",
      "participant",
      "match",
      "result",
    ]) {
      const error = await subscribeError(connAnon, [`SELECT * FROM ${table}`]);
      expect(error.message).toContain(table);
    }
  });

  test("the share views deliver exactly the published surface, live", async () => {
    await subscribe(connAnon, [
      `SELECT * FROM shared_tournament('${wireSlug}')`,
      `SELECT * FROM shared_participants('${wireSlug}')`,
      `SELECT * FROM shared_matches('${wireSlug}')`,
      `SELECT * FROM shared_results('${wireSlug}')`,
    ]);
    await waitFor(
      "the shared bracket delivered",
      () => rowsOf(connAnon.db.sharedMatches.iter()).length === 3,
    );
    const header = rowsOf(connAnon.db.sharedTournament.iter());
    expect(header.length).toBe(1);
    expect(header[0]!.name).toBe("Wire Cup");
    expect(header[0]!.status.tag).toBe("Published");
    // Exactly the shared-audience fields — no organizer handle, no
    // slug, no row ids.
    expect(keysOf(header[0]!)).toEqual(["discipline", "format", "name", "status"]);
    const participants = rowsOf(connAnon.db.sharedParticipants.iter());
    expect(participants.length).toBe(4);
    expect(keysOf(participants[0]!)).toEqual(["name", "participantId", "seed"]);
    const matches = rowsOf(connAnon.db.sharedMatches.iter());
    expect(keysOf(matches[0]!)).toEqual(["bracket", "indexInRound", "key", "round", "slots"]);
    expect(rowsOf(connAnon.db.sharedResults.iter())).toEqual([]);

    // A result reported over the wire reaches the anonymous share
    // surface as a live update, in the same shared-audience shape.
    const first = rowsOf(connA.db.organizerMatches.iter()).find(
      (row) => row.round === 1 && row.indexInRound === 0,
    )!;
    const [slotA, slotB] = first.slots;
    if (slotA?.tag !== "Participant" || slotB?.tag !== "Participant") {
      throw new Error("the first winners match is not a participant pairing");
    }
    await connA.reducers.reportResult({
      matchId: first.matchId,
      sides: [
        { participantId: slotA.value.participantId, outcome: { tag: "Win" }, score: undefined },
        { participantId: slotB.value.participantId, outcome: { tag: "Loss" }, score: undefined },
      ],
    });
    await waitFor(
      "the shared result delivered",
      () => rowsOf(connAnon.db.sharedResults.iter()).length === 1,
    );
    const result = rowsOf(connAnon.db.sharedResults.iter())[0]!;
    expect(result.matchKey).toBe(first.key);
    expect(keysOf(result)).toEqual(["matchKey", "seq", "sides"]);
    // The header's status moved with it: published -> live.
    await waitFor(
      "the shared header now live",
      () => rowsOf(connAnon.db.sharedTournament.iter())[0]?.status.tag === "Live",
    );
    // The owner's results surface receives the same record — the
    // positive control for the organizer_results legs asserted empty
    // elsewhere.
    await waitFor(
      "A's organizer results delivered",
      () => rowsOf(connA.db.organizerResults.iter()).length === 1,
    );
    // And the live delta does not leak sideways: after the mutation,
    // the foreign and anonymous organizer caches are still empty.
    await sleep(300);
    expect(rowsOf(connB.db.organizerResults.iter())).toEqual([]);
    expect(rowsOf(connB.db.organizerMatches.iter())).toEqual([]);
    expect(rowsOf(connAnon.db.organizerResults.iter())).toEqual([]);
    expect(rowsOf(connAnon.db.organizerMatches.iter())).toEqual([]);
  });

  test("draft and unknown slugs deliver nothing", async () => {
    await subscribe(connShare, [
      `SELECT * FROM shared_tournament('${draftSlug}')`,
      `SELECT * FROM shared_participants('${draftSlug}')`,
      `SELECT * FROM shared_matches('${draftSlug}')`,
      "SELECT * FROM shared_tournament('unknownslug0')",
      "SELECT * FROM shared_results('unknownslug0')",
      // This connection's positive control: its own session surface
      // answers in the same batch, so the empty share caches are a
      // gate result, not a dead connection.
      "SELECT * FROM session_state",
    ]);
    await sleep(500);
    expect(rowsOf(connShare.db.sharedTournament.iter())).toEqual([]);
    expect(rowsOf(connShare.db.sharedParticipants.iter())).toEqual([]);
    expect(rowsOf(connShare.db.sharedMatches.iter())).toEqual([]);
    expect(rowsOf(connShare.db.sharedResults.iter())).toEqual([]);
    const session = rowsOf(connShare.db.sessionState.iter());
    expect(session.length).toBe(1);
    expect(session[0]!.state.tag).toBe("Unauthenticated");
  });

  test("a reducer call across the boundary is refused on the wire", async () => {
    // The wire does not deliver the reducer's message to the caller:
    // on 2.15 every throw form (Error, string, renamed Error —
    // measured 2026-11-15) arrives as an opaque InternalError, "The
    // instance encountered a fatal error.", so "Tournament not found"
    // is a server-log fact on this surface; the harness suite pins
    // the message itself. What the wire proves is the refusal, with
    // no effect on the owner's data — and that the same call succeeds
    // for the owner of another tournament, so the refusal is the
    // ownership guard, not a transport or encoding failure.
    await expect(
      connB.reducers.addParticipant({ tournamentId: wireId, name: "Intruder" }),
    ).rejects.toThrow();
    await sleep(300);
    expect(rowsOf(connA.db.organizerParticipants.iter()).length).toBe(4);
    // B's identical call on its own tournament goes through.
    const bId = rowsOf(connB.db.myTournaments.iter())[0]!.tournamentId;
    await connB.reducers.addParticipant({ tournamentId: bId, name: "B Solo" });
    await subscribe(connB, [`SELECT * FROM organizer_participants(${bId})`]);
    await waitFor(
      "B's own roster delivered",
      () => rowsOf(connB.db.organizerParticipants.iter()).length === 1,
    );
  });

  test("a reducer that fails after writing rolls the whole transaction back", async () => {
    // addParticipants inserts line by line and validates each name as
    // it goes: on the still-draft second tournament, the second line
    // here is over the name limit, so the call fails AFTER the first
    // line's insert. Atomicity is the platform's promise — the
    // wire-level proof is that the first line is nowhere to be found
    // afterwards. (The view cache merges both of A's roster
    // subscriptions, so the assertions are by name.)
    const draftId = rowsOf(connA.db.myTournaments.iter()).find(
      (row) => row.name === "Draft Cup",
    )!.tournamentId;
    await subscribe(connA, [`SELECT * FROM organizer_participants(${draftId})`]);
    const tooLong = "x".repeat(121);
    await expect(
      connA.reducers.addParticipants({
        tournamentId: draftId,
        text: `Rolled Back\n${tooLong}`,
      }),
    ).rejects.toThrow();
    await sleep(300);
    const names = rowsOf(connA.db.organizerParticipants.iter()).map((row) => row.name);
    expect(names).not.toContain("Rolled Back");
    expect(names).not.toContain(tooLong);
    expect(names.sort()).toEqual(["P1", "P2", "P3", "P4"]);
  });
});
