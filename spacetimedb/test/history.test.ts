import { describe, expect, test } from "vite-plus/test";
import type { DbSide } from "../src/lib";
import * as moduleExports from "../src/index";
import {
  as,
  asModule,
  authFor,
  makeHarness as makeUnseededHarness,
  seedTestSecret,
  type Harness,
} from "./harness";

function makeHarness(): Harness {
  const harness = makeUnseededHarness();
  seedTestSecret(harness);
  return harness;
}

const ALICE = "alice@example.com";
const BOB = "bob@example.com";

function winOver(
  winnerId: bigint,
  loserId: bigint,
  winnerScore?: number,
  loserScore?: number,
): DbSide[] {
  return [
    { participantId: winnerId, outcome: { tag: "win" }, score: winnerScore },
    { participantId: loserId, outcome: { tag: "loss" }, score: loserScore },
  ];
}

interface Setup {
  tournamentId: bigint;
  ids: Map<string, bigint>;
  matchId: bigint;
  matchIds: bigint[];
}

function publishedTournament(harness: Harness, names: string[]): Setup {
  as(harness, ALICE, (ctx) => {
    moduleExports.createTournament(ctx, {
      name: "History Cup",
      discipline: "Chess",
      format: { tag: "single_elimination" },
    });
  });
  const mine = moduleExports.myTournaments(harness.viewContext(authFor(ALICE)));
  const tournamentId = mine[0]!.tournamentId;
  as(harness, ALICE, (ctx) => {
    moduleExports.addParticipants(ctx, { tournamentId, text: names.join("\n") });
  });
  const participants = moduleExports.organizerParticipants(harness.viewContext(authFor(ALICE)), {
    tournamentId,
  });
  const ids = new Map(participants.map((p) => [p.name, p.participantId]));
  as(harness, ALICE, (ctx) => {
    moduleExports.reorderSeeding(ctx, {
      tournamentId,
      orderedParticipantIds: names.map((name) => ids.get(name)!),
    });
  });
  as(harness, ALICE, (ctx) => {
    moduleExports.generateBracket(ctx, { tournamentId });
  });
  as(harness, ALICE, (ctx) => {
    moduleExports.publishTournament(ctx, { tournamentId });
  });
  const matches = moduleExports.organizerMatches(harness.viewContext(authFor(ALICE)), {
    tournamentId,
  });
  return {
    tournamentId,
    ids,
    matchId: matches[0]!.matchId,
    matchIds: matches.map((m) => m.matchId),
  };
}

function stored(sides: DbSide[]): unknown {
  return sides.map((side) => ({
    participantId: side.participantId,
    outcome: { tag: side.outcome.tag, value: {} },
    score: side.score,
  }));
}

function changes(harness: Harness, sub: string, tournamentId: bigint) {
  return moduleExports.organizerScoreChanges(harness.viewContext(authFor(sub)), { tournamentId });
}

function rowCounts(harness: Harness, tournamentId: bigint) {
  return asModule(harness, (ctx) => ({
    // oxlint-disable-next-line unicorn/no-useless-spread -- SpacetimeDB index filters return a lazy iterator with no array methods; the spread is what materializes it
    scoreChanges: [...ctx.db.scoreChange.tournamentId.filter(tournamentId)].length,
    // oxlint-disable-next-line unicorn/no-useless-spread -- SpacetimeDB index filters return a lazy iterator with no array methods; the spread is what materializes it
    results: [...ctx.db.result.tournamentId.filter(tournamentId)].length,
  }));
}

function report(harness: Harness, matchId: bigint, sides: DbSide[]): void {
  as(harness, ALICE, (ctx) => {
    moduleExports.reportResult(ctx, { matchId, sides });
  });
}

describe("score change history", () => {
  test("a first report writes a history row with empty previousSides", () => {
    const harness = makeHarness();
    const { tournamentId, ids, matchId } = publishedTournament(harness, ["A", "B"]);
    const sides = winOver(ids.get("A")!, ids.get("B")!, 2, 1);
    report(harness, matchId, sides);

    const owner = moduleExports.currentOrganizer(harness.viewContext(authFor(ALICE)));
    const rows = changes(harness, ALICE, tournamentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchId).toBe(matchId);
    expect(rows[0]!.previousSides).toEqual([]);
    expect(rows[0]!.newSides).toEqual(stored(sides));
    expect(rows[0]!.changedBy).toBe(owner!.userId);
    expect(rows[0]!.changedAt.microsSinceUnixEpoch).toBe(100_000_000n);
  });

  test("a correction writes a second row chaining previousSides to the first report", () => {
    const harness = makeHarness();
    const { tournamentId, ids, matchId } = publishedTournament(harness, ["A", "B", "C", "D"]);
    const first = winOver(ids.get("A")!, ids.get("D")!, 2, 0);
    const corrected = winOver(ids.get("A")!, ids.get("D")!, 3, 1);
    report(harness, matchId, first);
    report(harness, matchId, corrected);

    const rows = changes(harness, ALICE, tournamentId);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.previousSides).toEqual([]);
    expect(rows[0]!.newSides).toEqual(stored(first));
    expect(rows[1]!.previousSides).toEqual(stored(first));
    expect(rows[1]!.newSides).toEqual(stored(corrected));
    expect(rows[1]!.changeId).toBeGreaterThan(rows[0]!.changeId);
  });

  test("the view returns rows for the owner and nothing for a non-owner", () => {
    const harness = makeHarness();
    const { tournamentId, ids, matchId } = publishedTournament(harness, ["A", "B"]);
    report(harness, matchId, winOver(ids.get("A")!, ids.get("B")!));
    expect(changes(harness, ALICE, tournamentId)).toHaveLength(1);
    expect(changes(harness, BOB, tournamentId)).toEqual([]);
  });

  test("deleteTournament removes the history rows", () => {
    const harness = makeHarness();
    const { tournamentId, ids, matchId } = publishedTournament(harness, ["A", "B"]);
    report(harness, matchId, winOver(ids.get("A")!, ids.get("B")!));
    expect(changes(harness, ALICE, tournamentId)).toHaveLength(1);
    as(harness, ALICE, (ctx) => {
      moduleExports.deleteTournament(ctx, { tournamentId });
    });
    const remaining = asModule(harness, (ctx) => [
      // oxlint-disable-next-line unicorn/no-useless-spread -- SpacetimeDB index filters return a lazy iterator with no array methods; the spread is what materializes it
      ...ctx.db.scoreChange.tournamentId.filter(tournamentId),
    ]);
    expect(remaining).toEqual([]);
    expect(changes(harness, ALICE, tournamentId)).toEqual([]);
  });
});

describe("lifecycle rejection messages", () => {
  test("publishing a published tournament carries the exact legacy message", () => {
    const harness = makeHarness();
    const { tournamentId } = publishedTournament(harness, ["A", "B"]);
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.publishTournament(ctx, { tournamentId });
      }),
    ).toThrow("Cannot publish: the tournament is published");
  });

  test("editing the roster of a live tournament carries the exact legacy message", () => {
    const harness = makeHarness();
    const { ids, matchId } = publishedTournament(harness, ["A", "B", "C", "D"]);
    report(harness, matchId, winOver(ids.get("A")!, ids.get("D")!));
    const tournamentId = moduleExports.myTournaments(harness.viewContext(authFor(ALICE)))[0]!
      .tournamentId;
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.addParticipant(ctx, { tournamentId, name: "Late" });
      }),
    ).toThrow("Cannot edit the roster: the tournament is live");
  });

  test("reporting on a draft carries the exact legacy message", () => {
    const harness = makeHarness();
    as(harness, ALICE, (ctx) => {
      moduleExports.createTournament(ctx, {
        name: "Draft Cup",
        discipline: "Chess",
        format: { tag: "single_elimination" },
      });
    });
    const tournamentId = moduleExports.myTournaments(harness.viewContext(authFor(ALICE)))[0]!
      .tournamentId;
    as(harness, ALICE, (ctx) => {
      moduleExports.addParticipants(ctx, { tournamentId, text: "A\nB" });
    });
    const participants = moduleExports.organizerParticipants(harness.viewContext(authFor(ALICE)), {
      tournamentId,
    });
    const ids = new Map(participants.map((p) => [p.name, p.participantId]));
    as(harness, ALICE, (ctx) => {
      moduleExports.generateBracket(ctx, { tournamentId });
    });
    const matches = moduleExports.organizerMatches(harness.viewContext(authFor(ALICE)), {
      tournamentId,
    });
    const before = rowCounts(harness, tournamentId);
    expect(before).toEqual({ scoreChanges: 0, results: 0 });
    expect(() =>
      report(harness, matches[0]!.matchId, winOver(ids.get("A")!, ids.get("B")!)),
    ).toThrow("Cannot report a result: the tournament is draft");
    expect(rowCounts(harness, tournamentId)).toEqual(before);
  });

  test("a correction that would reopen a completed tournament carries the exact legacy message", () => {
    const harness = makeHarness();
    const { tournamentId, ids, matchIds } = publishedTournament(harness, ["A", "B", "C", "D"]);
    report(harness, matchIds[0]!, winOver(ids.get("A")!, ids.get("D")!));
    report(harness, matchIds[1]!, winOver(ids.get("B")!, ids.get("C")!));
    report(harness, matchIds[2]!, winOver(ids.get("A")!, ids.get("B")!));
    const before = rowCounts(harness, tournamentId);
    expect(before).toEqual({ scoreChanges: 3, results: 3 });
    expect(() => report(harness, matchIds[0]!, winOver(ids.get("D")!, ids.get("A")!))).toThrow(
      "Cannot correct: this would reopen a completed tournament",
    );
    expect(rowCounts(harness, tournamentId)).toEqual(before);
  });
});
