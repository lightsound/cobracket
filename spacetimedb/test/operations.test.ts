import { describe, expect, test } from "vite-plus/test";
import type { DbSide, FormatArg } from "../src/lib";
import * as moduleExports from "../src/index";
import {
  organizerView,
  sharedView,
  type ComposedBracket,
  type ComposedMatch,
  type OrganizerView,
} from "./compose";
import { as, asModule, authFor, makeHarness, type Harness } from "./harness";

// The operations parity suite (migration slice M2): the port of
// convex/operations.test.ts (1,112 lines) onto the SpacetimeDB module
// harness. Same discipline as the original — drive the operations API
// through the same registrations the client calls, and assert
// external behavior: results in, progression / standings / ready
// matches out, never internal bookkeeping.
//
// What changes in the port, and why:
// - The harness is synchronous: Convex's async mutations and
//   `rejects.toThrow` become direct reducer calls and sync throws.
//   Error *messages* are the contract and are asserted unchanged.
// - Reducers return nothing, so createTournament's Convex return
//   ({ tournamentId, shareSlug }) is read back from my_tournaments
//   (newest first), and participant ids from organizer_participants.
// - getTournament / getSharedTournament are composed client-side
//   from the flat views + the format engine (compose.ts, ADR 0031),
//   exactly as the M3 client will.
// - reportResult's Convex return ({ status, voided }) has no reducer
//   counterpart: status is asserted on the organizer header view, and
//   "what this append voided" as the composed progression's
//   voidedMatchKeys difference across the call — the same set,
//   derived from the same append-only records.
// - Convex's "unauthenticated callers are refused" suite is REPLACED
//   by the platform-form test below ("there is no unauthenticated
//   caller on this platform"): every connection carries a
//   server-minted Identity, so no caller is unauthenticated — an
//   unbound identity binds on its first act and owns only its own
//   scope, and identity is still resolved before any row lookup
//   (foreign ≡ missing, asserted in the foreign-organizer test). The
//   view-side unbound behavior is pinned in auth.test.ts.
// - getTournament's malformed-string-id case is inexpressible: the
//   organizer views take a u64 id, so there is no string to
//   malform. Nonexistent and foreign ids answer undefined and carry
//   the property (ids are per-table sequences, so "an id from
//   another table" is not a distinct value class here).

const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const CAROL = "carol@example.com";

type OutcomeTag = DbSide["outcome"]["tag"];

function winOver(winnerId: bigint, loserId: bigint, loserOutcome: OutcomeTag = "loss"): DbSide[] {
  return [
    { participantId: winnerId, outcome: { tag: "win" }, score: undefined },
    { participantId: loserId, outcome: { tag: loserOutcome }, score: undefined },
  ];
}

// Create a tournament as `sub` and read its handles back from
// my_tournaments, newest first — the reducer returns nothing.
function create(
  harness: Harness,
  sub: string,
  args: { name: string; discipline: string; format?: FormatArg },
): { tournamentId: bigint; shareSlug: string } {
  as(harness, sub, (ctx) => {
    moduleExports.createTournament(ctx, {
      name: args.name,
      discipline: args.discipline,
      format: args.format ?? { tag: "single_elimination" },
    });
  });
  const mine = moduleExports.myTournaments(harness.viewContext(authFor(sub)));
  const row = mine[0]!;
  return { tournamentId: row.tournamentId, shareSlug: row.shareSlug };
}

// The Organizer's composed read of a tournament they own: undefined
// is a failure here.
function ownedView(harness: Harness, sub: string, tournamentId: bigint): OrganizerView {
  const view = organizerView(harness, sub, tournamentId);
  expect(view).toBeDefined();
  return view!;
}

// Non-null bracket accessor: most assertions run after generation.
function bracketOf(view: { bracket: ComposedBracket | null }): ComposedBracket {
  expect(view.bracket).not.toBeNull();
  return view.bracket!;
}

interface Setup {
  tournamentId: bigint;
  shareSlug: string;
  ids: Map<string, bigint>;
}

// Create a tournament, enter the roster in one paste, pin the pasted
// order as manual seeding (so pairings are deterministic to assert
// against), and generate the bracket. Seeds follow the names' order:
// names[0] is seed 1.
function seededTournament(
  harness: Harness,
  sub: string,
  names: string[],
  format: FormatArg = { tag: "single_elimination" },
): Setup {
  const { tournamentId, shareSlug } = create(harness, sub, {
    name: "Test Cup",
    discipline: "Street Fighter 6",
    format,
  });
  as(harness, sub, (ctx) => {
    moduleExports.addParticipants(ctx, { tournamentId, text: names.join("\n") });
  });
  const view = ownedView(harness, sub, tournamentId);
  const ids = new Map(view.participants.map((p) => [p.name, p.participantId]));
  as(harness, sub, (ctx) => {
    moduleExports.reorderSeeding(ctx, {
      tournamentId,
      orderedParticipantIds: names.map((name) => ids.get(name)!),
    });
  });
  as(harness, sub, (ctx) => {
    moduleExports.generateBracket(ctx, { tournamentId });
  });
  return { tournamentId, shareSlug, ids };
}

function matchAt(
  bracket: ComposedBracket,
  section: "winners" | "losers" | "grand_final",
  round: number,
  indexInRound: number,
): ComposedMatch {
  const match = bracket.matches.find(
    (m) => m.bracket === section && m.round === round && m.indexInRound === indexInRound,
  );
  expect(match).toBeDefined();
  return match!;
}

function occupantIds(match: ComposedMatch): (bigint | undefined)[] {
  return match.occupants.map((o) => (o.kind === "participant" ? o.participantId : undefined));
}

function report(harness: Harness, sub: string, matchId: bigint, sides: DbSide[]): void {
  as(harness, sub, (ctx) => {
    moduleExports.reportResult(ctx, { matchId, sides });
  });
}

function voidedKeys(harness: Harness, sub: string, tournamentId: bigint): string[] {
  return bracketOf(ownedView(harness, sub, tournamentId)).voidedMatchKeys;
}

// What one reportResult call voided: the per-record difference of the
// composed voidedMatchKeys across the call (multiset difference — a
// key whose second record is voided by this call counts, even when
// the key was already voided before it), as { matchId, matchKey }
// pairs — the module form of the Convex mutation's `voided` return,
// which filters the same per-record indices against a pre-call
// derivation.
function newlyVoided(
  harness: Harness,
  sub: string,
  tournamentId: bigint,
  before: readonly string[],
): { matchId: bigint; matchKey: string }[] {
  const bracket = bracketOf(ownedView(harness, sub, tournamentId));
  const remaining = new Map<string, number>();
  for (const key of before) {
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const fresh: { matchId: bigint; matchKey: string }[] = [];
  for (const key of bracket.voidedMatchKeys) {
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
    } else {
      fresh.push({
        matchKey: key,
        matchId: bracket.matches.find((m) => m.key === key)!.matchId!,
      });
    }
  }
  return fresh;
}

describe("operations parity", () => {
  // -------------------------------------------------------------------------
  // The full lifecycle: create → roster → generate → publish → report → complete
  // -------------------------------------------------------------------------

  test("a tournament runs end to end through the operations API", () => {
    const harness = makeHarness();

    // Create (story 1–3): freeform discipline, single elimination, draft.
    const { tournamentId, shareSlug } = create(harness, ALICE, {
      name: "  Friday Night Fights ",
      discipline: "Street Fighter 6",
      format: { tag: "single_elimination" },
    });

    // Roster (stories 4–6): bulk paste with blank lines, one-by-one
    // add, rename, remove.
    as(harness, ALICE, (ctx) => {
      moduleExports.addParticipants(ctx, {
        tournamentId,
        text: "Alice\n\n  Bob \nCarol\n",
      });
    });
    const participantIdOf = (name: string) =>
      ownedView(harness, ALICE, tournamentId).participants.find((p) => p.name === name)!
        .participantId;
    const aliceId = participantIdOf("Alice");
    const daveId = (() => {
      as(harness, ALICE, (ctx) => {
        moduleExports.addParticipant(ctx, { tournamentId, name: "Dave" });
      });
      return participantIdOf("Dave");
    })();
    as(harness, ALICE, (ctx) => {
      moduleExports.renameParticipant(ctx, { participantId: daveId, name: "Dai" });
    });
    const typoId = (() => {
      as(harness, ALICE, (ctx) => {
        moduleExports.addParticipant(ctx, { tournamentId, name: "Typo" });
      });
      return participantIdOf("Typo");
    })();
    as(harness, ALICE, (ctx) => {
      moduleExports.removeParticipant(ctx, { participantId: typoId });
    });

    let view = ownedView(harness, ALICE, tournamentId);
    expect(view.name).toBe("Friday Night Fights");
    expect(view.status).toBe("draft");
    expect(view.discipline).toBe("Street Fighter 6");
    expect(view.participants.map((p) => p.name)).toEqual(["Alice", "Bob", "Carol", "Dai"]);
    expect(view.participants.map((p) => p.seed)).toEqual([1, 2, 3, 4]);
    expect(view.bracket).toBeNull();

    // Seeding (story 8): manual reorder, then generate (story 9).
    const bobId = participantIdOf("Bob");
    const carolId = participantIdOf("Carol");
    const daiId = participantIdOf("Dai");
    as(harness, ALICE, (ctx) => {
      moduleExports.reorderSeeding(ctx, {
        tournamentId,
        orderedParticipantIds: [daiId, carolId, bobId, aliceId],
      });
    });
    as(harness, ALICE, (ctx) => {
      moduleExports.generateBracket(ctx, { tournamentId });
    });

    view = ownedView(harness, ALICE, tournamentId);
    expect(view.seeding).toBe("manual");
    let bracket = bracketOf(view);
    // Standard placement for 4 seeds: (1 vs 4) and (2 vs 3).
    expect(occupantIds(matchAt(bracket, "winners", 1, 0))).toEqual([daiId, aliceId]);
    expect(occupantIds(matchAt(bracket, "winners", 1, 1))).toEqual([carolId, bobId]);
    expect(bracket.readyMatchKeys).toHaveLength(2);
    expect(bracket.completed).toBe(false);

    // Publish (story 11): draft → published, Share Link goes visible.
    expect(sharedView(harness, shareSlug)).toBeUndefined();
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });
    const shared = sharedView(harness, shareSlug);
    expect(shared).toBeDefined();
    expect(shared!.status).toBe("published");

    // First result (story 12): published → live, roster and structure
    // lock.
    const semiA = matchAt(bracket, "winners", 1, 0);
    const beforeA = voidedKeys(harness, ALICE, tournamentId);
    report(harness, ALICE, semiA.matchId!, [
      { participantId: daiId, outcome: { tag: "win" }, score: 2 },
      { participantId: aliceId, outcome: { tag: "loss" }, score: 1 },
    ]);
    expect(ownedView(harness, ALICE, tournamentId).status).toBe("live");
    expect(newlyVoided(harness, ALICE, tournamentId, beforeA)).toEqual([]);

    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.addParticipant(ctx, { tournamentId, name: "Late" });
      }),
    ).toThrow(/live/);
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.generateBracket(ctx, { tournamentId });
      }),
    ).toThrow(/live/);
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.reorderSeeding(ctx, {
          tournamentId,
          orderedParticipantIds: [aliceId, bobId, carolId, daiId],
        });
      }),
    ).toThrow(/live/);

    // Progress to the final: current/next matches come from
    // readyMatchKeys (story 15).
    const semiB = matchAt(bracket, "winners", 1, 1);
    report(harness, ALICE, semiB.matchId!, winOver(carolId, bobId));
    view = ownedView(harness, ALICE, tournamentId);
    bracket = bracketOf(view);
    const final = matchAt(bracket, "winners", 2, 0);
    expect(bracket.readyMatchKeys).toEqual([final.key]);
    expect(occupantIds(final)).toEqual([daiId, carolId]);
    expect(matchAt(bracket, "winners", 1, 0).sides).toEqual([
      { participantId: daiId, outcome: "win", score: 2 },
      { participantId: aliceId, outcome: "loss", score: 1 },
    ]);

    // Final result: automatic completion (story 16) and standings
    // (story 23).
    report(harness, ALICE, final.matchId!, winOver(daiId, carolId));
    expect(ownedView(harness, ALICE, tournamentId).status).toBe("completed");

    view = ownedView(harness, ALICE, tournamentId);
    expect(view.status).toBe("completed");
    bracket = bracketOf(view);
    expect(bracket.completed).toBe(true);
    expect(bracket.championId).toBe(daiId);
    expect(bracket.standings).toEqual([
      { participantId: daiId, placement: 1 },
      { participantId: carolId, placement: 2 },
      ...[aliceId, bobId]
        .sort((a, b) => String(a).localeCompare(String(b)))
        .map((participantId) => ({ participantId, placement: 3 })),
    ]);
  });

  // -------------------------------------------------------------------------
  // Correction → downstream void → re-entry (story 14, ADR 0005)
  // -------------------------------------------------------------------------

  test("a correction voids downstream results, which are surfaced and re-enterable", () => {
    const harness = makeHarness();
    const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const { tournamentId, ids } = seededTournament(harness, ALICE, names);
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });
    const id = (name: string) => ids.get(name)!;

    let view = ownedView(harness, ALICE, tournamentId);
    let bracket = bracketOf(view);
    // Standard placement for 8 seeds: round 1 pairs (1v8), (4v5),
    // (2v7), (3v6).
    const r1m0 = matchAt(bracket, "winners", 1, 0);
    const r1m1 = matchAt(bracket, "winners", 1, 1);
    expect(occupantIds(r1m0)).toEqual([id("A"), id("H")]);
    expect(occupantIds(r1m1)).toEqual([id("D"), id("E")]);

    report(harness, ALICE, r1m0.matchId!, winOver(id("A"), id("H")));
    report(harness, ALICE, r1m1.matchId!, winOver(id("D"), id("E")));

    view = ownedView(harness, ALICE, tournamentId);
    bracket = bracketOf(view);
    const semi = matchAt(bracket, "winners", 2, 0);
    expect(occupantIds(semi)).toEqual([id("A"), id("D")]);
    report(harness, ALICE, semi.matchId!, winOver(id("A"), id("D")));

    // Correct round 1: H actually beat A. The semifinal's recorded
    // result (A over D) no longer pairs — it is voided.
    const beforeCorrection = voidedKeys(harness, ALICE, tournamentId);
    report(harness, ALICE, r1m0.matchId!, winOver(id("H"), id("A")));
    expect(ownedView(harness, ALICE, tournamentId).status).toBe("live");
    expect(newlyVoided(harness, ALICE, tournamentId, beforeCorrection)).toEqual([
      { matchId: semi.matchId, matchKey: semi.key },
    ]);

    // The derived view agrees: the semifinal is open again with the
    // corrected pairing, and flagged as awaiting re-entry.
    view = ownedView(harness, ALICE, tournamentId);
    bracket = bracketOf(view);
    const reopenedSemi = matchAt(bracket, "winners", 2, 0);
    expect(reopenedSemi.state).toBe("ready");
    expect(occupantIds(reopenedSemi)).toEqual([id("H"), id("D")]);
    expect(bracket.voidedMatchKeys).toEqual([semi.key]);
    // The corrected-over round-1 record is superseded, not voided.
    expect(matchAt(bracket, "winners", 1, 0).winnerId).toBe(id("H"));

    // Reporting an unrelated match while the semifinal still awaits
    // re-entry voids nothing new: the outstanding void stays visible
    // as voidedMatchKeys.
    const beforeUnrelated = voidedKeys(harness, ALICE, tournamentId);
    report(harness, ALICE, matchAt(bracket, "winners", 1, 2).matchId!, winOver(id("B"), id("G")));
    expect(newlyVoided(harness, ALICE, tournamentId, beforeUnrelated)).toEqual([]);

    // Re-enter the semifinal; play continues with nothing else lost.
    const beforeReentry = voidedKeys(harness, ALICE, tournamentId);
    report(harness, ALICE, semi.matchId!, winOver(id("H"), id("D")));
    expect(newlyVoided(harness, ALICE, tournamentId, beforeReentry)).toEqual([]);
    view = ownedView(harness, ALICE, tournamentId);
    bracket = bracketOf(view);
    expect(bracket.voidedMatchKeys).toEqual([]);
    expect(matchAt(bracket, "winners", 2, 0).winnerId).toBe(id("H"));

    // Correct round 1 back (A beat H after all): the semifinal's
    // re-entered result no longer pairs and is voided a second time.
    // The per-record difference reports it, exactly as Convex's
    // return — filtered from the same engine indices — would.
    const beforeSecondVoid = voidedKeys(harness, ALICE, tournamentId);
    report(harness, ALICE, r1m0.matchId!, winOver(id("A"), id("H")));
    expect(newlyVoided(harness, ALICE, tournamentId, beforeSecondVoid)).toEqual([
      { matchId: semi.matchId, matchKey: semi.key },
    ]);
    view = ownedView(harness, ALICE, tournamentId);
    bracket = bracketOf(view);
    expect(bracket.voidedMatchKeys).toEqual([semi.key]);
    const reopenedAgain = matchAt(bracket, "winners", 2, 0);
    expect(reopenedAgain.state).toBe("ready");
    expect(occupantIds(reopenedAgain)).toEqual([id("A"), id("D")]);
  });

  test("corrections cannot reopen a completed tournament, but may refine it", () => {
    const harness = makeHarness();
    const { tournamentId, ids } = seededTournament(harness, ALICE, ["A", "B", "C", "D"]);
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });
    const id = (name: string) => ids.get(name)!;

    const view = ownedView(harness, ALICE, tournamentId);
    const bracket = bracketOf(view);
    const r1m0 = matchAt(bracket, "winners", 1, 0);
    const r1m1 = matchAt(bracket, "winners", 1, 1);
    const final = matchAt(bracket, "winners", 2, 0);
    report(harness, ALICE, r1m0.matchId!, winOver(id("A"), id("D")));
    report(harness, ALICE, r1m1.matchId!, winOver(id("B"), id("C")));
    report(harness, ALICE, final.matchId!, winOver(id("A"), id("B")));
    expect(ownedView(harness, ALICE, tournamentId).status).toBe("completed");

    // A correction that would void the final (and so reopen play) is
    // refused: the lifecycle is one-way.
    expect(() => report(harness, ALICE, r1m0.matchId!, winOver(id("D"), id("A")))).toThrow(
      /reopen/,
    );

    // A correction that keeps the tournament completed (fixing the
    // recorded score of the final) is fine.
    report(harness, ALICE, final.matchId!, [
      { participantId: id("A"), outcome: { tag: "win" }, score: 3 },
      { participantId: id("B"), outcome: { tag: "loss" }, score: 2 },
    ]);
    expect(ownedView(harness, ALICE, tournamentId).status).toBe("completed");
    const after = ownedView(harness, ALICE, tournamentId);
    expect(bracketOf(after).championId).toBe(id("A"));
  });

  // -------------------------------------------------------------------------
  // Walkovers (story 13) and outcome validation
  // -------------------------------------------------------------------------

  test("a no-show is a walkover result; the bracket advances without regeneration", () => {
    const harness = makeHarness();
    const { tournamentId, ids } = seededTournament(harness, ALICE, ["A", "B"]);
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });

    report(
      harness,
      ALICE,
      matchAt(bracketOf(ownedView(harness, ALICE, tournamentId)), "winners", 1, 0).matchId!,
      winOver(ids.get("A")!, ids.get("B")!, "walkover"),
    );
    // A 2-participant bracket completes on its first (walkover)
    // result: published → live → completed in one report.
    expect(ownedView(harness, ALICE, tournamentId).status).toBe("completed");
    const view = ownedView(harness, ALICE, tournamentId);
    expect(bracketOf(view).championId).toBe(ids.get("A"));
  });

  test("invalid results are refused with the engine's reasons", () => {
    const harness = makeHarness();
    const { tournamentId, ids } = seededTournament(harness, ALICE, ["A", "B", "C", "D"]);
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });
    const id = (name: string) => ids.get(name)!;
    const view = ownedView(harness, ALICE, tournamentId);
    const bracket = bracketOf(view);
    const r1m0 = matchAt(bracket, "winners", 1, 0);
    const final = matchAt(bracket, "winners", 2, 0);

    // Draws are not allowed under elimination.
    expect(() =>
      report(harness, ALICE, r1m0.matchId!, [
        { participantId: id("A"), outcome: { tag: "draw" }, score: undefined },
        { participantId: id("D"), outcome: { tag: "draw" }, score: undefined },
      ]),
    ).toThrow(/draw/);

    // Both sides must be the match's current occupants.
    expect(() => report(harness, ALICE, r1m0.matchId!, winOver(id("A"), id("B")))).toThrow(
      /does not apply/,
    );

    // A pending match (occupants undetermined) cannot take a result.
    expect(() => report(harness, ALICE, final.matchId!, winOver(id("A"), id("B")))).toThrow(
      /does not apply/,
    );

    // Exactly two sides.
    expect(() =>
      report(harness, ALICE, r1m0.matchId!, [
        { participantId: id("A"), outcome: { tag: "win" }, score: undefined },
      ]),
    ).toThrow(/two sides/);
  });

  // -------------------------------------------------------------------------
  // Seeding and regeneration (stories 7–10)
  // -------------------------------------------------------------------------

  test("random seeding assigns a 1..n permutation and pairs by standard placement", () => {
    const harness = makeHarness();
    const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const { tournamentId } = create(harness, ALICE, {
      name: "Shuffled",
      discipline: "Tekken 8",
      format: { tag: "single_elimination" },
    });
    as(harness, ALICE, (ctx) => {
      moduleExports.addParticipants(ctx, { tournamentId, text: names.join("\n") });
    });
    as(harness, ALICE, (ctx) => {
      moduleExports.generateBracket(ctx, { tournamentId });
    });

    const view = ownedView(harness, ALICE, tournamentId);
    expect(view.seeding).toBe("random");
    expect(view.participants.map((p) => p.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(view.participants.map((p) => p.name).sort()).toEqual(names);

    // Whatever the shuffle produced, the bracket pairs those seeds by
    // standard placement: (1v8), (4v5), (2v7), (3v6).
    const bySeed = new Map(view.participants.map((p) => [p.seed, p.participantId]));
    const bracket = bracketOf(view);
    expect(occupantIds(matchAt(bracket, "winners", 1, 0))).toEqual([bySeed.get(1), bySeed.get(8)]);
    expect(occupantIds(matchAt(bracket, "winners", 1, 1))).toEqual([bySeed.get(4), bySeed.get(5)]);
    expect(occupantIds(matchAt(bracket, "winners", 1, 2))).toEqual([bySeed.get(2), bySeed.get(7)]);
    expect(occupantIds(matchAt(bracket, "winners", 1, 3))).toEqual([bySeed.get(3), bySeed.get(6)]);
  });

  test("roster changes invalidate a generated bracket; regeneration picks them up", () => {
    const harness = makeHarness();
    const { tournamentId } = seededTournament(harness, ALICE, ["A", "B", "C", "D"]);

    // A rename does not touch the structure.
    let view = ownedView(harness, ALICE, tournamentId);
    as(harness, ALICE, (ctx) => {
      moduleExports.renameParticipant(ctx, {
        participantId: view.participants[0]!.participantId,
        name: "Ace",
      });
    });
    view = ownedView(harness, ALICE, tournamentId);
    expect(view.bracket).not.toBeNull();

    // Adding a participant drops the stale bracket until regeneration.
    as(harness, ALICE, (ctx) => {
      moduleExports.addParticipant(ctx, { tournamentId, name: "Late" });
    });
    view = ownedView(harness, ALICE, tournamentId);
    expect(view.bracket).toBeNull();
    const lateId = view.participants.find((p) => p.name === "Late")!.participantId;

    as(harness, ALICE, (ctx) => {
      moduleExports.generateBracket(ctx, { tournamentId });
    });
    view = ownedView(harness, ALICE, tournamentId);
    const bracket = bracketOf(view);
    const seeded = bracket.matches.flatMap((m) =>
      m.occupants.flatMap((o) => (o.kind === "participant" ? [o.participantId] : [])),
    );
    expect(seeded).toContain(lateId);
  });

  test("roster edits and regeneration stay available while published, until the first result", () => {
    const harness = makeHarness();
    const { tournamentId, shareSlug } = seededTournament(harness, ALICE, ["A", "B", "C", "D"]);
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });

    // A late roster change (story 10) drops the published bracket...
    as(harness, ALICE, (ctx) => {
      moduleExports.addParticipant(ctx, { tournamentId, name: "E" });
    });
    let shared = sharedView(harness, shareSlug);
    expect(shared!.status).toBe("published");
    expect(shared!.bracket).toBeNull();

    // ...and regeneration restores it, still published, roster of five.
    as(harness, ALICE, (ctx) => {
      moduleExports.generateBracket(ctx, { tournamentId });
    });
    shared = sharedView(harness, shareSlug);
    expect(shared!.status).toBe("published");
    expect(bracketOf(shared!).matches.length).toBeGreaterThan(0);
    expect(shared!.participants).toHaveLength(5);
  });

  test("bracket generation needs a roster of at least two", () => {
    const harness = makeHarness();
    const { tournamentId } = create(harness, ALICE, {
      name: "Tiny",
      discipline: "Chess",
      format: { tag: "single_elimination" },
    });
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.generateBracket(ctx, { tournamentId });
      }),
    ).toThrow(/two participants/);
    as(harness, ALICE, (ctx) => {
      moduleExports.addParticipant(ctx, { tournamentId, name: "Solo" });
    });
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.generateBracket(ctx, { tournamentId });
      }),
    ).toThrow(/two participants/);
  });

  test("reorderSeeding requires a complete permutation of the roster", () => {
    const harness = makeHarness();
    const { tournamentId, ids } = seededTournament(harness, ALICE, ["A", "B", "C"]);
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.reorderSeeding(ctx, {
          tournamentId,
          orderedParticipantIds: [ids.get("A")!, ids.get("B")!],
        });
      }),
    ).toThrow(/every participant/);
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.reorderSeeding(ctx, {
          tournamentId,
          orderedParticipantIds: [ids.get("A")!, ids.get("B")!, ids.get("B")!],
        });
      }),
    ).toThrow(/every participant/);
  });

  // -------------------------------------------------------------------------
  // Formats (story 3)
  // -------------------------------------------------------------------------

  test("double elimination defaults to grand-final reset on and generates all sections", () => {
    const harness = makeHarness();
    const { tournamentId } = seededTournament(harness, ALICE, ["A", "B", "C", "D"], {
      tag: "double_elimination",
      value: { grandFinalReset: undefined },
    });
    const view = ownedView(harness, ALICE, tournamentId);
    expect(view.format).toEqual({ family: "double_elimination", grandFinalReset: true });
    const sections = new Set(bracketOf(view).matches.map((m) => m.bracket));
    expect(sections).toEqual(new Set(["winners", "losers", "grand_final"]));
  });

  // -------------------------------------------------------------------------
  // Lifecycle status enforcement
  // -------------------------------------------------------------------------

  test("publishing requires a draft with a generated bracket", () => {
    const harness = makeHarness();
    const { tournamentId } = create(harness, ALICE, {
      name: "Unready",
      discipline: "Chess",
      format: { tag: "single_elimination" },
    });
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.publishTournament(ctx, { tournamentId });
      }),
    ).toThrow(/Generate the bracket/);
    as(harness, ALICE, (ctx) => {
      moduleExports.addParticipants(ctx, { tournamentId, text: "A\nB" });
    });
    as(harness, ALICE, (ctx) => {
      moduleExports.generateBracket(ctx, { tournamentId });
    });
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.publishTournament(ctx, { tournamentId });
      }),
    ).toThrow(/published/);
  });

  test("results cannot be recorded on a draft", () => {
    const harness = makeHarness();
    const { tournamentId, ids } = seededTournament(harness, ALICE, ["A", "B"]);
    const view = ownedView(harness, ALICE, tournamentId);
    const final = matchAt(bracketOf(view), "winners", 1, 0);
    expect(() =>
      report(harness, ALICE, final.matchId!, winOver(ids.get("A")!, ids.get("B")!)),
    ).toThrow(/draft/);
  });

  // -------------------------------------------------------------------------
  // Authorization (ADR 0031): identity is native, binding is the first act
  // -------------------------------------------------------------------------

  test("there is no unauthenticated caller: an unbound identity binds on its first act and owns only its own scope", () => {
    const harness = makeHarness();
    // Alice's tournament exists before Carol ever acts.
    const { tournamentId } = seededTournament(harness, ALICE, ["A", "B"]);

    // A failed first act binds nobody: createTournament's reducer
    // binds through requireBoundUser, then requireName throws — the
    // atomic transaction rolls the binding back with everything else.
    // (The reducer-level bind-then-fail case; auth.test.ts pins the
    // harness-seam form.)
    expect(() =>
      as(harness, CAROL, (ctx) => {
        moduleExports.createTournament(ctx, {
          name: "   ",
          discipline: "Chess",
          format: { tag: "single_elimination" },
        });
      }),
    ).toThrow(/must not be empty/);
    expect(moduleExports.sessionState(harness.viewContext(authFor(CAROL)))).toEqual([
      { state: { tag: "unauthenticated" } },
    ]);

    // A successful first act binds the identity as a fresh user...
    const carols = create(harness, CAROL, {
      name: "Carol's Cup",
      discipline: "Chess",
      format: { tag: "single_elimination" },
    });
    const carolUser = moduleExports.currentOrganizer(harness.viewContext(authFor(CAROL)));
    const aliceUser = moduleExports.currentOrganizer(harness.viewContext(authFor(ALICE)));
    expect(carolUser).toBeDefined();
    expect(carolUser!.userId).not.toBe(aliceUser!.userId);
    expect(moduleExports.sessionState(harness.viewContext(authFor(CAROL)))).toEqual([
      { state: { tag: "organizer", value: { userId: carolUser!.userId } } },
    ]);
    expect(carols.tournamentId).not.toBe(tournamentId);

    // ...whose scope is only its own: identity is resolved before any
    // row lookup, so Carol's reducers cannot reach Alice's tournament,
    // and the refusal is the same "not found" a missing id earns.
    expect(() =>
      as(harness, CAROL, (ctx) => {
        moduleExports.addParticipant(ctx, { tournamentId, name: "X" });
      }),
    ).toThrow(/Tournament not found/);
    expect(organizerView(harness, CAROL, tournamentId)).toBeUndefined();
    expect(moduleExports.myTournaments(harness.viewContext(authFor(CAROL)))).toHaveLength(1);
  });

  test("another organizer's tournament is untouchable and reads as not found", () => {
    const harness = makeHarness();
    // Bob is a bound organizer who owns nothing.
    as(harness, BOB, (ctx) => {
      moduleExports.bindIdentity(ctx, {});
    });
    const { tournamentId, ids } = seededTournament(harness, ALICE, ["A", "B"]);
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });
    const view = ownedView(harness, ALICE, tournamentId);
    const final = matchAt(bracketOf(view), "winners", 1, 0);

    // The Organizer read answers nothing for a foreign tournament —
    // the same answer as for a missing one — while every reducer
    // refuses outright.
    expect(organizerView(harness, BOB, tournamentId)).toBeUndefined();
    expect(() =>
      as(harness, BOB, (ctx) => {
        moduleExports.addParticipant(ctx, { tournamentId, name: "X" });
      }),
    ).toThrow(/not found/);
    expect(() =>
      as(harness, BOB, (ctx) => {
        moduleExports.updateTournament(ctx, { tournamentId, name: "Hijacked" });
      }),
    ).toThrow(/not found/);
    expect(() =>
      as(harness, BOB, (ctx) => {
        moduleExports.deleteTournament(ctx, { tournamentId });
      }),
    ).toThrow(/not found/);
    expect(() =>
      as(harness, BOB, (ctx) => {
        moduleExports.generateBracket(ctx, { tournamentId });
      }),
    ).toThrow(/not found/);
    expect(() =>
      as(harness, BOB, (ctx) => {
        moduleExports.publishTournament(ctx, { tournamentId });
      }),
    ).toThrow(/not found/);
    expect(() =>
      report(harness, BOB, final.matchId!, winOver(ids.get("A")!, ids.get("B")!)),
    ).toThrow(/not found/);
    expect(() =>
      as(harness, BOB, (ctx) => {
        moduleExports.removeParticipant(ctx, { participantId: ids.get("A")! });
      }),
    ).toThrow(/not found/);

    // The owner's state is intact and the intruder's list is empty.
    const intact = ownedView(harness, ALICE, tournamentId);
    expect(intact.name).toBe("Test Cup");
    expect(intact.participants).toHaveLength(2);
    expect(moduleExports.myTournaments(harness.viewContext(authFor(BOB)))).toEqual([]);

    // A foreign document and a missing one read identically, so
    // probing ids confirms nothing about their existence.
    expect(() =>
      as(harness, BOB, (ctx) => {
        moduleExports.renameParticipant(ctx, { participantId: ids.get("A")!, name: "X" });
      }),
    ).toThrow(/Participant not found/);
    asModule(harness, (ctx) => {
      ctx.db.participant.id.delete(ids.get("B")!);
    });
    expect(() =>
      as(harness, BOB, (ctx) => {
        moduleExports.renameParticipant(ctx, { participantId: ids.get("B")!, name: "X" });
      }),
    ).toThrow(/Participant not found/);
  });

  // -------------------------------------------------------------------------
  // The Share Link's public read (stories 17, 21–23)
  // -------------------------------------------------------------------------

  test("the share link works without auth, hides drafts, and leaks nothing organizer-only", () => {
    const harness = makeHarness();
    const { tournamentId, shareSlug, ids } = seededTournament(harness, ALICE, ["A", "B", "C", "D"]);

    // Unknown slugs and drafts both read as nothing.
    expect(sharedView(harness, "nosuchslug00")).toBeUndefined();
    expect(sharedView(harness, shareSlug)).toBeUndefined();

    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });
    const view = ownedView(harness, ALICE, tournamentId);
    report(
      harness,
      ALICE,
      matchAt(bracketOf(view), "winners", 1, 0).matchId!,
      winOver(ids.get("A")!, ids.get("D")!),
    );

    // Spectators (no identity at all) see the live bracket, results,
    // and standings...
    const shared = sharedView(harness, shareSlug);
    expect(shared).toBeDefined();
    expect(shared!.status).toBe("live");
    const sharedBracket = bracketOf(shared!);
    expect(matchAt(sharedBracket, "winners", 1, 0).winnerId).toBe(ids.get("A"));
    expect(sharedBracket.standings.length).toBe(4);

    // ...but nothing organizer-only. Convex's test string-scans the
    // serialized view for the forbidden field names and the
    // organizer's id value. The port runs the name half verbatim on
    // the serialized composed shape, and the structural half as a key
    // walk over the same shape (module.test.ts pins the underlying
    // view rows' key sets exactly). The id-value half has no u64
    // analogue: ids are per-table sequence numbers whose decimal
    // forms collide with ordinary values (seeds, scores), where
    // Convex's are long random strings.
    const serialized = JSON.stringify(shared, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    const keys = new Set<string>();
    const collectKeys = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(collectKeys);
      } else if (value !== null && typeof value === "object") {
        for (const [key, entry] of Object.entries(value)) {
          keys.add(key);
          collectKeys(entry);
        }
      }
    };
    collectKeys(shared);
    for (const forbidden of [
      "userId",
      "organizerId",
      "recordedBy",
      "shareSlug",
      "tournamentId",
      "matchId",
      "resultId",
    ]) {
      expect(keys.has(forbidden)).toBe(false);
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });

  test("the share link respects the visibility field", () => {
    const harness = makeHarness();
    const { tournamentId, shareSlug } = seededTournament(harness, ALICE, ["A", "B"]);
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });
    expect(sharedView(harness, shareSlug)).toBeDefined();

    // No MVP reducer can set "private", but the public gate must
    // already honor it so exposing the field later cannot leak by
    // omission.
    asModule(harness, (ctx) => {
      const tournament = ctx.db.tournament.id.find(tournamentId)!;
      ctx.db.tournament.id.update({ ...tournament, visibility: { tag: "private" } });
    });
    expect(sharedView(harness, shareSlug)).toBeUndefined();
  });

  test("writes are bounded: roster size, name length, and scores", () => {
    const harness = makeHarness();
    const { tournamentId, ids } = seededTournament(harness, ALICE, ["A", "B"]);

    // Scores must be finite (the wire admits NaN/Infinity).
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });
    const view = ownedView(harness, ALICE, tournamentId);
    expect(() =>
      report(harness, ALICE, matchAt(bracketOf(view), "winners", 1, 0).matchId!, [
        { participantId: ids.get("A")!, outcome: { tag: "win" }, score: Number.NaN },
        { participantId: ids.get("B")!, outcome: { tag: "loss" }, score: undefined },
      ]),
    ).toThrow(/finite/);

    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.addParticipant(ctx, { tournamentId, name: "x".repeat(121) });
      }),
    ).toThrow(/at most 120 characters/);

    // The roster cap is pinned on both sides of the boundary: filling
    // to exactly 128 succeeds, the 129th is refused (single and bulk
    // alike).
    as(harness, ALICE, (ctx) => {
      moduleExports.addParticipants(ctx, {
        tournamentId,
        text: Array.from({ length: 126 }, (_, i) => `P${i}`).join("\n"),
      });
    });
    const full = ownedView(harness, ALICE, tournamentId);
    expect(full.participants).toHaveLength(128);
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.addParticipant(ctx, { tournamentId, name: "Overflow" });
      }),
    ).toThrow(/at most 128 participants/);
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.addParticipants(ctx, { tournamentId, text: "Overflow" });
      }),
    ).toThrow(/at most 128 participants/);
  });

  test("results are bounded: append-only corrections cannot grow a tournament forever", () => {
    const harness = makeHarness();
    const { tournamentId, ids } = seededTournament(harness, ALICE, ["A", "B"]);
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });
    const matchId = matchAt(
      bracketOf(ownedView(harness, ALICE, tournamentId)),
      "winners",
      1,
      0,
    ).matchId!;
    const sides = winOver(ids.get("A")!, ids.get("B")!);
    // MAX_RESULTS: four records for each of the 256 matches a full
    // roster can generate. Seeded directly — a thousand reports would
    // only slow the test.
    asModule(harness, (ctx) => {
      const tournament = ctx.db.tournament.id.find(tournamentId)!;
      for (let i = 0; i < 1024; i++) {
        ctx.db.result.insert({
          id: 0n,
          tournamentId,
          matchId,
          sides,
          recordedBy: tournament.userId,
          reportedAt: ctx.timestamp,
        });
      }
    });
    expect(() => report(harness, ALICE, matchId, sides)).toThrow(/at most 1024 results/);
  });

  // -------------------------------------------------------------------------
  // Disciplines (story 2)
  // -------------------------------------------------------------------------

  test("disciplines deduplicate on their normalized form and feed suggestions", () => {
    const harness = makeHarness();
    create(harness, ALICE, {
      name: "First",
      discipline: "Street Fighter 6",
      format: { tag: "single_elimination" },
    });
    create(harness, ALICE, {
      name: "Second",
      discipline: "  street   FIGHTER 6 ",
      format: { tag: "single_elimination" },
    });
    create(harness, ALICE, {
      name: "Third",
      discipline: "Strive",
      format: { tag: "single_elimination" },
    });

    const disciplines = asModule(harness, (ctx) => [...ctx.db.discipline.iter()]);
    expect(disciplines.map((d) => d.name).sort()).toEqual(["Street Fighter 6", "Strive"]);

    // Suggestions are a public prefix search over the normalized form.
    const suggest = (prefix: string) =>
      moduleExports
        .suggestDisciplines(harness.anonymousViewContext(), { prefix })
        .map((row) => row.name);
    expect(suggest("STREET f")).toEqual(["Street Fighter 6"]);
    expect(suggest("str")).toEqual(["Street Fighter 6", "Strive"]);
    expect(suggest("  ")).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Tournament settings (story 26)
  // -------------------------------------------------------------------------

  test("name and discipline are editable in every status; the bracket is untouched", () => {
    const harness = makeHarness();
    const { tournamentId, shareSlug, ids } = seededTournament(harness, ALICE, ["A", "B"]);
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });

    // Whitespace is trimmed like at creation; the discipline dedups
    // onto the existing row; the generated bracket survives (labels
    // are not structure).
    as(harness, ALICE, (ctx) => {
      moduleExports.updateTournament(ctx, {
        tournamentId,
        name: "  Friday Finals ",
        discipline: "  street fighter 6",
      });
    });
    let view = ownedView(harness, ALICE, tournamentId);
    expect(view.name).toBe("Friday Finals");
    expect(view.discipline).toBe("Street Fighter 6");
    expect(view.bracket).not.toBeNull();
    const disciplines = asModule(harness, (ctx) => [...ctx.db.discipline.iter()]);
    expect(disciplines).toHaveLength(1);

    // A partial update leaves the other fields alone.
    as(harness, ALICE, (ctx) => {
      moduleExports.updateTournament(ctx, { tournamentId, discipline: "Tekken 8" });
    });
    view = ownedView(harness, ALICE, tournamentId);
    expect(view.name).toBe("Friday Finals");
    expect(view.discipline).toBe("Tekken 8");

    // Still editable once completed: a typo on the record is worth
    // fixing.
    report(
      harness,
      ALICE,
      matchAt(bracketOf(view), "winners", 1, 0).matchId!,
      winOver(ids.get("A")!, ids.get("B")!),
    );
    as(harness, ALICE, (ctx) => {
      moduleExports.updateTournament(ctx, { tournamentId, name: "Friday Finals #1" });
    });
    view = ownedView(harness, ALICE, tournamentId);
    expect(view.status).toBe("completed");
    expect(view.name).toBe("Friday Finals #1");
    // The Share Link shows the new labels.
    const shared = sharedView(harness, shareSlug);
    expect(shared!.name).toBe("Friday Finals #1");
    expect(shared!.discipline).toBe("Tekken 8");

    // The same bounds as creation.
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.updateTournament(ctx, { tournamentId, name: "   " });
      }),
    ).toThrow(/must not be empty/);
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.updateTournament(ctx, { tournamentId, discipline: "" });
      }),
    ).toThrow(/must not be empty/);
  });

  test("changing the format drops the bracket pre-live and is refused once live", () => {
    const harness = makeHarness();
    const { tournamentId, ids } = seededTournament(harness, ALICE, ["A", "B", "C", "D"]);
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });

    // Re-sending the current format is a no-op: the bracket stays.
    as(harness, ALICE, (ctx) => {
      moduleExports.updateTournament(ctx, {
        tournamentId,
        format: { tag: "single_elimination" },
      });
    });
    let view = ownedView(harness, ALICE, tournamentId);
    expect(view.bracket).not.toBeNull();

    // A real change invalidates the generated structure, like a
    // roster edit.
    as(harness, ALICE, (ctx) => {
      moduleExports.updateTournament(ctx, {
        tournamentId,
        format: { tag: "double_elimination", value: { grandFinalReset: undefined } },
      });
    });
    view = ownedView(harness, ALICE, tournamentId);
    expect(view.format).toEqual({ family: "double_elimination", grandFinalReset: true });
    expect(view.bracket).toBeNull();
    expect(view.status).toBe("published");
    as(harness, ALICE, (ctx) => {
      moduleExports.generateBracket(ctx, { tournamentId });
    });
    view = ownedView(harness, ALICE, tournamentId);
    expect(new Set(bracketOf(view).matches.map((m) => m.bracket))).toEqual(
      new Set(["winners", "losers", "grand_final"]),
    );

    // Toggling an option within the family is a change too.
    as(harness, ALICE, (ctx) => {
      moduleExports.updateTournament(ctx, {
        tournamentId,
        format: { tag: "double_elimination", value: { grandFinalReset: false } },
      });
    });
    view = ownedView(harness, ALICE, tournamentId);
    expect(view.format).toEqual({ family: "double_elimination", grandFinalReset: false });
    expect(view.bracket).toBeNull();

    // Once a result exists the structure is locked; the format goes
    // with it.
    as(harness, ALICE, (ctx) => {
      moduleExports.generateBracket(ctx, { tournamentId });
    });
    view = ownedView(harness, ALICE, tournamentId);
    report(
      harness,
      ALICE,
      matchAt(bracketOf(view), "winners", 1, 0).matchId!,
      winOver(ids.get("A")!, ids.get("D")!),
    );
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.updateTournament(ctx, {
          tournamentId,
          format: { tag: "single_elimination" },
        });
      }),
    ).toThrow(/live/);
    // ...but re-sending the unchanged format alongside a rename still
    // works.
    as(harness, ALICE, (ctx) => {
      moduleExports.updateTournament(ctx, {
        tournamentId,
        name: "Renamed live",
        format: { tag: "double_elimination", value: { grandFinalReset: false } },
      });
    });
    view = ownedView(harness, ALICE, tournamentId);
    expect(view.name).toBe("Renamed live");
    expect(view.bracket).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Tournament deletion (story 27, ADR 0011)
  // -------------------------------------------------------------------------

  test("deleting a tournament removes it whole, in any status, and darkens its Share Link", () => {
    const harness = makeHarness();

    // A draft with nothing attached.
    const empty = create(harness, ALICE, {
      name: "asdf",
      discipline: "Chess",
      format: { tag: "single_elimination" },
    });
    as(harness, ALICE, (ctx) => {
      moduleExports.deleteTournament(ctx, { tournamentId: empty.tournamentId });
    });
    expect(organizerView(harness, ALICE, empty.tournamentId)).toBeUndefined();

    // A completed tournament with roster, bracket, and results
    // (including a correction): everything that hangs off it goes
    // with it.
    const { tournamentId, shareSlug, ids } = seededTournament(harness, ALICE, ["A", "B", "C", "D"]);
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });
    let view = ownedView(harness, ALICE, tournamentId);
    const bracket = bracketOf(view);
    const r1m0 = matchAt(bracket, "winners", 1, 0);
    report(harness, ALICE, r1m0.matchId!, winOver(ids.get("A")!, ids.get("D")!));
    report(harness, ALICE, r1m0.matchId!, winOver(ids.get("D")!, ids.get("A")!));
    report(
      harness,
      ALICE,
      matchAt(bracket, "winners", 1, 1).matchId!,
      winOver(ids.get("B")!, ids.get("C")!),
    );
    view = ownedView(harness, ALICE, tournamentId);
    report(
      harness,
      ALICE,
      matchAt(bracketOf(view), "winners", 2, 0).matchId!,
      winOver(ids.get("D")!, ids.get("B")!),
    );
    expect(ownedView(harness, ALICE, tournamentId).status).toBe("completed");
    expect(sharedView(harness, shareSlug)).toBeDefined();

    // An unrelated tournament of the same Organizer must be
    // untouched.
    const other = seededTournament(harness, ALICE, ["X", "Y"]);

    as(harness, ALICE, (ctx) => {
      moduleExports.deleteTournament(ctx, { tournamentId });
    });

    expect(organizerView(harness, ALICE, tournamentId)).toBeUndefined();
    expect(sharedView(harness, shareSlug)).toBeUndefined();
    expect(
      moduleExports.myTournaments(harness.viewContext(authFor(ALICE))).map((row) => row.name),
    ).toEqual(["Test Cup"]);
    const leftovers = asModule(harness, (ctx) => ({
      // oxlint-disable-next-line unicorn/no-useless-spread -- SpacetimeDB index filters return a lazy iterator with no array methods; the spread is what materializes it
      participants: [...ctx.db.participant.tournamentId.filter(tournamentId)].length,
      // oxlint-disable-next-line unicorn/no-useless-spread -- SpacetimeDB index filters return a lazy iterator with no array methods; the spread is what materializes it
      matches: [...ctx.db.match.tournamentId.filter(tournamentId)].length,
      // oxlint-disable-next-line unicorn/no-useless-spread -- SpacetimeDB index filters return a lazy iterator with no array methods; the spread is what materializes it
      results: [...ctx.db.result.tournamentId.filter(tournamentId)].length,
    }));
    expect(leftovers).toEqual({ participants: 0, matches: 0, results: 0 });
    // Deleting twice reads as not found, like any missing tournament.
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.deleteTournament(ctx, { tournamentId });
      }),
    ).toThrow(/not found/);

    const intact = ownedView(harness, ALICE, other.tournamentId);
    expect(intact.participants).toHaveLength(2);
    expect(intact.bracket).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // The Organizer read by id
  // -------------------------------------------------------------------------

  test("the organizer views answer nothing for unknown ids instead of throwing", () => {
    const harness = makeHarness();
    const { tournamentId } = seededTournament(harness, ALICE, ["A", "B"]);
    // Convex's getTournament also answers null for a malformed string
    // id and for a well-formed id of another table; both are
    // inexpressible here (the views take a u64, and ids are per-table
    // sequences), so the port pins the expressible cases: an id that
    // names nothing, and (in the foreign test above) an id that
    // names someone else's.
    expect(organizerView(harness, ALICE, 999_999n)).toBeUndefined();
    // The real one still resolves.
    expect(ownedView(harness, ALICE, tournamentId).tournamentId).toBe(tournamentId);
  });

  // -------------------------------------------------------------------------
  // Organizer's tournament list
  // -------------------------------------------------------------------------

  test("listMyTournaments returns only the caller's tournaments, newest first", () => {
    const harness = makeHarness();
    const first = create(harness, ALICE, {
      name: "First",
      discipline: "Chess",
      format: { tag: "single_elimination" },
    });
    const second = create(harness, ALICE, {
      name: "Second",
      discipline: "Go",
      format: { tag: "double_elimination", value: { grandFinalReset: undefined } },
    });
    create(harness, BOB, {
      name: "Other",
      discipline: "Chess",
      format: { tag: "single_elimination" },
    });

    const mine = moduleExports.myTournaments(harness.viewContext(authFor(ALICE)));
    expect(mine.map((row) => row.name)).toEqual(["Second", "First"]);
    expect(mine[0]).toEqual({
      tournamentId: second.tournamentId,
      name: "Second",
      // Stored unit variants materialize with an empty value object
      // (the harness's table-decoded form; view-constructed ones
      // omit it — the M1 asymmetry).
      status: { tag: "draft", value: {} },
      format: { tag: "double_elimination", value: { grandFinalReset: true } },
      discipline: "Go",
      shareSlug: second.shareSlug,
    });
    expect(mine[1]!.tournamentId).toBe(first.tournamentId);
  });
});
