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
import {
  as,
  asModule,
  authFor,
  makeHarness as makeUnseededHarness,
  seedTestSecret,
  TEST_SECRET_HEX,
  type Harness,
} from "./harness";

// Seeded with the fixed test key (share slugs derive from the module secret): docs/adr/0032-module-secret-in-a-private-table.md.
function makeHarness(): Harness {
  const harness = makeUnseededHarness();
  seedTestSecret(harness);
  return harness;
}

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

function ownedView(harness: Harness, sub: string, tournamentId: bigint): OrganizerView {
  const view = organizerView(harness, sub, tournamentId);
  expect(view).toBeDefined();
  return view!;
}

function bracketOf(view: { bracket: ComposedBracket | null }): ComposedBracket {
  expect(view.bracket).not.toBeNull();
  return view.bracket!;
}

interface Setup {
  tournamentId: bigint;
  shareSlug: string;
  ids: Map<string, bigint>;
}

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
  test("a tournament runs end to end through the operations API", () => {
    const harness = makeHarness();

    const { tournamentId, shareSlug } = create(harness, ALICE, {
      name: "  Friday Night Fights ",
      discipline: "Street Fighter 6",
      format: { tag: "single_elimination" },
    });

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
    expect(occupantIds(matchAt(bracket, "winners", 1, 0))).toEqual([daiId, aliceId]);
    expect(occupantIds(matchAt(bracket, "winners", 1, 1))).toEqual([carolId, bobId]);
    expect(bracket.readyMatchKeys).toHaveLength(2);
    expect(bracket.completed).toBe(false);

    expect(sharedView(harness, shareSlug)).toBeUndefined();
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });
    const shared = sharedView(harness, shareSlug);
    expect(shared).toBeDefined();
    expect(shared!.status).toBe("published");

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

    const beforeCorrection = voidedKeys(harness, ALICE, tournamentId);
    report(harness, ALICE, r1m0.matchId!, winOver(id("H"), id("A")));
    expect(ownedView(harness, ALICE, tournamentId).status).toBe("live");
    expect(newlyVoided(harness, ALICE, tournamentId, beforeCorrection)).toEqual([
      { matchId: semi.matchId, matchKey: semi.key },
    ]);

    view = ownedView(harness, ALICE, tournamentId);
    bracket = bracketOf(view);
    const reopenedSemi = matchAt(bracket, "winners", 2, 0);
    expect(reopenedSemi.state).toBe("ready");
    expect(occupantIds(reopenedSemi)).toEqual([id("H"), id("D")]);
    expect(bracket.voidedMatchKeys).toEqual([semi.key]);
    expect(matchAt(bracket, "winners", 1, 0).winnerId).toBe(id("H"));

    const beforeUnrelated = voidedKeys(harness, ALICE, tournamentId);
    report(harness, ALICE, matchAt(bracket, "winners", 1, 2).matchId!, winOver(id("B"), id("G")));
    expect(newlyVoided(harness, ALICE, tournamentId, beforeUnrelated)).toEqual([]);

    const beforeReentry = voidedKeys(harness, ALICE, tournamentId);
    report(harness, ALICE, semi.matchId!, winOver(id("H"), id("D")));
    expect(newlyVoided(harness, ALICE, tournamentId, beforeReentry)).toEqual([]);
    view = ownedView(harness, ALICE, tournamentId);
    bracket = bracketOf(view);
    expect(bracket.voidedMatchKeys).toEqual([]);
    expect(matchAt(bracket, "winners", 2, 0).winnerId).toBe(id("H"));

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

    expect(() => report(harness, ALICE, r1m0.matchId!, winOver(id("D"), id("A")))).toThrow(
      /reopen/,
    );

    report(harness, ALICE, final.matchId!, [
      { participantId: id("A"), outcome: { tag: "win" }, score: 3 },
      { participantId: id("B"), outcome: { tag: "loss" }, score: 2 },
    ]);
    expect(ownedView(harness, ALICE, tournamentId).status).toBe("completed");
    const after = ownedView(harness, ALICE, tournamentId);
    expect(bracketOf(after).championId).toBe(id("A"));
  });

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

    expect(() =>
      report(harness, ALICE, r1m0.matchId!, [
        { participantId: id("A"), outcome: { tag: "draw" }, score: undefined },
        { participantId: id("D"), outcome: { tag: "draw" }, score: undefined },
      ]),
    ).toThrow(/draw/);

    expect(() => report(harness, ALICE, r1m0.matchId!, winOver(id("A"), id("B")))).toThrow(
      /does not apply/,
    );

    expect(() => report(harness, ALICE, final.matchId!, winOver(id("A"), id("B")))).toThrow(
      /does not apply/,
    );

    expect(() =>
      report(harness, ALICE, r1m0.matchId!, [
        { participantId: id("A"), outcome: { tag: "win" }, score: undefined },
      ]),
    ).toThrow(/two sides/);
  });

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

    let view = ownedView(harness, ALICE, tournamentId);
    as(harness, ALICE, (ctx) => {
      moduleExports.renameParticipant(ctx, {
        participantId: view.participants[0]!.participantId,
        name: "Ace",
      });
    });
    view = ownedView(harness, ALICE, tournamentId);
    expect(view.bracket).not.toBeNull();

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

    as(harness, ALICE, (ctx) => {
      moduleExports.addParticipant(ctx, { tournamentId, name: "E" });
    });
    let shared = sharedView(harness, shareSlug);
    expect(shared!.status).toBe("published");
    expect(shared!.bracket).toBeNull();

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

  test("there is no unauthenticated caller: an unbound identity binds on its first act and owns only its own scope", () => {
    const harness = makeHarness();
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
    as(harness, BOB, (ctx) => {
      moduleExports.bindIdentity(ctx, {});
    });
    const { tournamentId, ids } = seededTournament(harness, ALICE, ["A", "B"]);
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });
    const view = ownedView(harness, ALICE, tournamentId);
    const final = matchAt(bracketOf(view), "winners", 1, 0);

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

    const intact = ownedView(harness, ALICE, tournamentId);
    expect(intact.name).toBe("Test Cup");
    expect(intact.participants).toHaveLength(2);
    expect(moduleExports.myTournaments(harness.viewContext(authFor(BOB)))).toEqual([]);

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

  test("the share link works without auth, hides drafts, and leaks nothing organizer-only", () => {
    const harness = makeHarness();
    const { tournamentId, shareSlug, ids } = seededTournament(harness, ALICE, ["A", "B", "C", "D"]);

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

    // The public gate must already honor "private", though no MVP reducer can set it: docs/adr/0019-visibility-and-access.md.
    asModule(harness, (ctx) => {
      const tournament = ctx.db.tournament.id.find(tournamentId)!;
      ctx.db.tournament.id.update({ ...tournament, visibility: { tag: "private" } });
    });
    expect(sharedView(harness, shareSlug)).toBeUndefined();
  });

  test("writes are bounded: roster size, name length, and scores", () => {
    const harness = makeHarness();
    const { tournamentId, ids } = seededTournament(harness, ALICE, ["A", "B"]);

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

  test("names refuse control and invisible characters, while ordinary names pass", () => {
    const harness = makeHarness();
    const spoofed = /must not contain control or invisible characters/;
    const createNamed = (name: string) => () =>
      as(harness, ALICE, (ctx) => {
        moduleExports.createTournament(ctx, {
          name,
          discipline: "Chess",
          format: { tag: "single_elimination" },
        });
      });

    expect(createNamed("Final\u202E Cup")).toThrow(spoofed);
    expect(createNamed("Line\nBreak")).toThrow(spoofed);
    expect(createNamed("Next\u0085Line")).toThrow(spoofed);
    expect(createNamed("A\u007FB")).toThrow(spoofed);
    expect(createNamed("A\uFEFFB")).toThrow(spoofed);
    expect(createNamed("A\u200BB")).toThrow(spoofed);
    expect(createNamed("A\u200CB")).toThrow(spoofed);
    expect(createNamed("A\u200DB")).toThrow(spoofed);
    expect(createNamed("A\u2066B")).toThrow(spoofed);

    const { tournamentId } = create(harness, ALICE, {
      name: "\u5bae\u5d0e\u30ab\u30c3\u30d7 🏆",
      discipline: "\u5c06\u68cb",
      format: { tag: "single_elimination" },
    });
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.addParticipant(ctx, { tournamentId, name: "Alice\u200B" });
      }),
    ).toThrow(spoofed);
    as(harness, ALICE, (ctx) => {
      moduleExports.addParticipant(ctx, {
        tournamentId,
        name: "\u5c71\u7530\u592a\u90ce 🎮",
      });
    });
    const view = ownedView(harness, ALICE, tournamentId);
    expect(view.name).toBe("\u5bae\u5d0e\u30ab\u30c3\u30d7 🏆");
    expect(view.participants.map((participant) => participant.name)).toEqual([
      "\u5c71\u7530\u592a\u90ce 🎮",
    ]);
  });

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

    const suggest = (prefix: string) =>
      moduleExports
        .suggestDisciplines(harness.anonymousViewContext(), { prefix })
        .map((row) => row.name);
    expect(suggest("STREET f")).toEqual(["Street Fighter 6"]);
    expect(suggest("str")).toEqual(["Street Fighter 6", "Strive"]);
    expect(suggest("  ")).toEqual([]);
  });

  test("the global discipline list is capped, but existing disciplines stay reusable", () => {
    const harness = makeHarness();
    asModule(harness, (ctx) => {
      for (let i = 0; i < 1000; i++) {
        ctx.db.discipline.insert({
          id: 0n,
          name: `Seeded ${i}`,
          normalizedName: `seeded ${i}`,
        });
      }
    });

    expect(() =>
      create(harness, ALICE, {
        name: "One Too Many",
        discipline: "Brand New Discipline",
        format: { tag: "single_elimination" },
      }),
    ).toThrow(/Cannot add a new discipline: the list is limited to 1000/);

    create(harness, ALICE, {
      name: "Still Fine",
      discipline: "Seeded 42",
      format: { tag: "single_elimination" },
    });
    const disciplines = asModule(harness, (ctx) => [...ctx.db.discipline.iter()]);
    expect(disciplines).toHaveLength(1000);
  });

  test("the 1000th discipline is admitted, and the cap refuses only the 1001st", () => {
    const harness = makeHarness();
    asModule(harness, (ctx) => {
      for (let i = 0; i < 999; i++) {
        ctx.db.discipline.insert({
          id: 0n,
          name: `Seeded ${i}`,
          normalizedName: `seeded ${i}`,
        });
      }
    });

    create(harness, ALICE, {
      name: "At The Cap",
      discipline: "Thousandth Discipline",
      format: { tag: "single_elimination" },
    });
    let disciplines = asModule(harness, (ctx) => [...ctx.db.discipline.iter()]);
    expect(disciplines).toHaveLength(1000);

    expect(() =>
      create(harness, ALICE, {
        name: "One Too Many",
        discipline: "Brand New Discipline",
        format: { tag: "single_elimination" },
      }),
    ).toThrow(/Cannot add a new discipline: the list is limited to 1000/);

    create(harness, ALICE, {
      name: "Still Fine",
      discipline: "Seeded 42",
      format: { tag: "single_elimination" },
    });
    disciplines = asModule(harness, (ctx) => [...ctx.db.discipline.iter()]);
    expect(disciplines).toHaveLength(1000);
  });

  test("canonically equivalent discipline spellings deduplicate onto one row", () => {
    const harness = makeHarness();
    create(harness, ALICE, {
      name: "First",
      discipline: "Caf\u00e9",
      format: { tag: "single_elimination" },
    });
    create(harness, ALICE, {
      name: "Second",
      discipline: "Cafe\u0301",
      format: { tag: "single_elimination" },
    });

    const disciplines = asModule(harness, (ctx) => [...ctx.db.discipline.iter()]);
    expect(disciplines).toHaveLength(1);
    expect(disciplines[0]!.name).toBe("Caf\u00e9");

    const suggest = (prefix: string) =>
      moduleExports
        .suggestDisciplines(harness.anonymousViewContext(), { prefix })
        .map((row) => row.name);
    expect(suggest("caf\u00e9")).toEqual(["Caf\u00e9"]);
    expect(suggest("cafe\u0301")).toEqual(["Caf\u00e9"]);
  });

  test("name and discipline are editable in every status; the bracket is untouched", () => {
    const harness = makeHarness();
    const { tournamentId, shareSlug, ids } = seededTournament(harness, ALICE, ["A", "B"]);
    as(harness, ALICE, (ctx) => {
      moduleExports.publishTournament(ctx, { tournamentId });
    });

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

    as(harness, ALICE, (ctx) => {
      moduleExports.updateTournament(ctx, { tournamentId, discipline: "Tekken 8" });
    });
    view = ownedView(harness, ALICE, tournamentId);
    expect(view.name).toBe("Friday Finals");
    expect(view.discipline).toBe("Tekken 8");

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
    const shared = sharedView(harness, shareSlug);
    expect(shared!.name).toBe("Friday Finals #1");
    expect(shared!.discipline).toBe("Tekken 8");

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

    as(harness, ALICE, (ctx) => {
      moduleExports.updateTournament(ctx, {
        tournamentId,
        format: { tag: "single_elimination" },
      });
    });
    let view = ownedView(harness, ALICE, tournamentId);
    expect(view.bracket).not.toBeNull();

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

    as(harness, ALICE, (ctx) => {
      moduleExports.updateTournament(ctx, {
        tournamentId,
        format: { tag: "double_elimination", value: { grandFinalReset: false } },
      });
    });
    view = ownedView(harness, ALICE, tournamentId);
    expect(view.format).toEqual({ family: "double_elimination", grandFinalReset: false });
    expect(view.bracket).toBeNull();

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

  test("deleting a tournament removes it whole, in any status, and darkens its Share Link", () => {
    const harness = makeHarness();

    const empty = create(harness, ALICE, {
      name: "asdf",
      discipline: "Chess",
      format: { tag: "single_elimination" },
    });
    as(harness, ALICE, (ctx) => {
      moduleExports.deleteTournament(ctx, { tournamentId: empty.tournamentId });
    });
    expect(organizerView(harness, ALICE, empty.tournamentId)).toBeUndefined();

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
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.deleteTournament(ctx, { tournamentId });
      }),
    ).toThrow(/not found/);

    const intact = ownedView(harness, ALICE, other.tournamentId);
    expect(intact.participants).toHaveLength(2);
    expect(intact.bracket).not.toBeNull();
  });

  test("the organizer views answer nothing for unknown ids instead of throwing", () => {
    const harness = makeHarness();
    const { tournamentId } = seededTournament(harness, ALICE, ["A", "B"]);
    expect(organizerView(harness, ALICE, 999_999n)).toBeUndefined();
    expect(ownedView(harness, ALICE, tournamentId).tournamentId).toBe(tournamentId);
  });

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

describe("module secret and share slugs", () => {
  const OTHER_SECRET_HEX = "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";

  function seed(harness: Harness, keyHex: string): void {
    asModule(harness, (ctx) => {
      moduleExports.seedModuleSecret(ctx, { keyHex });
    });
  }

  test("seeding creates no binding and no user", () => {
    const harness = makeUnseededHarness();
    seed(harness, TEST_SECRET_HEX);
    const state = asModule(harness, (ctx) => ({
      secrets: [...ctx.db.moduleSecret.iter()],
      users: [...ctx.db.appUser.iter()].length,
      bindings: [...ctx.db.identityUser.iter()].length,
    }));
    expect(state.secrets).toHaveLength(1);
    expect(state.secrets[0]!.keyVersion).toBe(1);
    expect(state.secrets[0]!.key).toHaveLength(32);
    expect(state.users).toBe(0);
    expect(state.bindings).toBe(0);
    expect(moduleExports.sessionState(harness.viewContext(authFor(ALICE)))).toEqual([
      { state: { tag: "unauthenticated" } },
    ]);
  });

  test("a second seed is refused, whatever key it carries", () => {
    const harness = makeUnseededHarness();
    seed(harness, TEST_SECRET_HEX);
    expect(() => seed(harness, TEST_SECRET_HEX)).toThrow(/already seeded/);
    expect(() => seed(harness, OTHER_SECRET_HEX)).toThrow(/already seeded/);
  });

  test("seeding after an identity has bound is refused", () => {
    const harness = makeUnseededHarness();
    as(harness, ALICE, (ctx) => {
      moduleExports.bindIdentity(ctx, {});
    });
    expect(() => seed(harness, TEST_SECRET_HEX)).toThrow(
      /can only be seeded before any identity binds/,
    );
    expect(() =>
      create(harness, ALICE, {
        name: "Too Late",
        discipline: "Chess",
        format: { tag: "single_elimination" },
      }),
    ).toThrow(/Module secret is not seeded/);
  });

  test("malformed and short keys are refused", () => {
    const harness = makeUnseededHarness();
    expect(() => seed(harness, "not-a-hex-key")).toThrow(/hex/);
    expect(() => seed(harness, "abc")).toThrow(/hex/);
    expect(() => seed(harness, "abcd")).toThrow(/exactly 32 bytes, got 2/);
    expect(() => seed(harness, `${TEST_SECRET_HEX}00`)).toThrow(/exactly 32 bytes, got 33/);
    const secrets = asModule(harness, (ctx) => [...ctx.db.moduleSecret.iter()]);
    expect(secrets).toEqual([]);
  });

  test("creating a tournament on an unseeded database is an operational fault", () => {
    const harness = makeUnseededHarness();
    expect(() =>
      create(harness, ALICE, {
        name: "Unseeded",
        discipline: "Chess",
        format: { tag: "single_elimination" },
      }),
    ).toThrow(/Module secret is not seeded/);
    seedTestSecret(harness);
    const { shareSlug } = create(harness, ALICE, {
      name: "Seeded Late",
      discipline: "Chess",
      format: { tag: "single_elimination" },
    });
    expect(shareSlug).toMatch(/^[a-z0-9]{12}$/);
  });

  test("one organizer's slugs are unique and well-formed across many mints", () => {
    const harness = makeHarness();
    const slugs = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const { shareSlug } = create(harness, ALICE, {
        name: `Cup ${i}`,
        discipline: "Chess",
        format: { tag: "single_elimination" },
      });
      expect(shareSlug).toMatch(/^[a-z0-9]{12}$/);
      slugs.add(shareSlug);
    }
    expect(slugs.size).toBe(12);
    for (let i = 0; i < 3; i++) {
      const { shareSlug } = create(harness, BOB, {
        name: `Bob Cup ${i}`,
        discipline: "Chess",
        format: { tag: "single_elimination" },
      });
      expect(shareSlug).toMatch(/^[a-z0-9]{12}$/);
      slugs.add(shareSlug);
    }
    expect(slugs.size).toBe(15);
  });

  test("the first slug with the fixed test key is the golden vector", () => {
    const harness = makeHarness();
    // The slug byte layout pinned below is ADR 0032's derivation: docs/adr/0032-module-secret-in-a-private-table.md.
    const { shareSlug } = create(harness, ALICE, {
      name: "Golden",
      discipline: "Chess",
      format: { tag: "single_elimination" },
    });
    expect(shareSlug).toBe("vy0biguyup26");
  });

  test("the first slug is a function of the key: same key, same slug; different key, different slug", () => {
    const firstSlugWith = (keyHex: string): string => {
      const harness = makeUnseededHarness();
      seedTestSecret(harness, keyHex);
      return create(harness, ALICE, {
        name: "First",
        discipline: "Chess",
        format: { tag: "single_elimination" },
      }).shareSlug;
    };
    expect(firstSlugWith(TEST_SECRET_HEX)).toBe(firstSlugWith(TEST_SECRET_HEX));
    expect(firstSlugWith(OTHER_SECRET_HEX)).not.toBe(firstSlugWith(TEST_SECRET_HEX));
  });
});
