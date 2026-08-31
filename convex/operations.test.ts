// fallow-ignore-file circular-dependency -- the module map below excludes *.test.ts at runtime, so no test-to-test import exists; the analyzer cannot see the negative glob pattern
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Seam 2 lifecycle tests (docs/specs/mvp.md Testing Decisions): drive the
// operations API through the same functions the web UI and the MCP server
// call, and assert external behavior — results in, progression / standings /
// ready matches out — never internal bookkeeping.

// Test files are excluded: convex-test only needs the function modules, and
// globbing sibling tests would create test-to-test import cycles.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

type Test = ReturnType<typeof convexTest>;
type Organizer = ReturnType<Test["withIdentity"]>;

async function newOrganizer(t: Test): Promise<{ userId: Id<"users">; as: Organizer }> {
  const userId = await t.mutation(internal.auth.createUserAnonymous, {
    provider: "anonymous",
    providerAccountId: "",
    profile: {},
  });
  return { userId, as: t.withIdentity({ subject: userId }) };
}

type Outcome = "win" | "loss" | "draw" | "walkover" | "disqualification";

interface Side {
  participantId: Id<"participants">;
  outcome: Outcome;
  score?: number;
}

function winOver(
  winnerId: Id<"participants">,
  loserId: Id<"participants">,
  loserOutcome: Outcome = "loss",
): Side[] {
  return [
    { participantId: winnerId, outcome: "win" },
    { participantId: loserId, outcome: loserOutcome },
  ];
}

// Non-null bracket accessor: most assertions run after generation.
function bracketOf<V extends { bracket: unknown }>(view: V): NonNullable<V["bracket"]> {
  expect(view.bracket).not.toBeNull();
  return view.bracket as NonNullable<V["bracket"]>;
}

interface Setup {
  tournamentId: Id<"tournaments">;
  shareSlug: string;
  ids: Map<string, Id<"participants">>;
}

// Create a tournament, enter the roster in one paste, pin the pasted order
// as manual seeding (so pairings are deterministic to assert against), and
// generate the bracket. Seeds follow the names' order: names[0] is seed 1.
async function seededTournament(
  as: Organizer,
  names: string[],
  format:
    | { family: "single_elimination" }
    | { family: "double_elimination"; grandFinalReset?: boolean } = {
    family: "single_elimination",
  },
): Promise<Setup> {
  const { tournamentId, shareSlug } = await as.mutation(api.operations.createTournament, {
    name: "Test Cup",
    discipline: "Street Fighter 6",
    format,
  });
  await as.mutation(api.operations.addParticipants, { tournamentId, text: names.join("\n") });
  const view = await as.query(api.operations.getTournament, { tournamentId });
  const ids = new Map(view.participants.map((p) => [p.name, p.participantId]));
  await as.mutation(api.operations.reorderSeeding, {
    tournamentId,
    orderedParticipantIds: names.map((name) => ids.get(name)!),
  });
  await as.mutation(api.operations.generateBracket, { tournamentId });
  return { tournamentId, shareSlug, ids };
}

function matchAt<M extends { bracket: string; round: number; indexInRound: number }>(
  bracket: { matches: M[] },
  section: "winners" | "losers" | "grand_final",
  round: number,
  indexInRound: number,
): M {
  const match = bracket.matches.find(
    (m) => m.bracket === section && m.round === round && m.indexInRound === indexInRound,
  );
  expect(match).toBeDefined();
  return match!;
}

function occupantIds(match: {
  occupants: ({ kind: "participant"; participantId: Id<"participants"> } | { kind: string })[];
}) {
  return match.occupants.map((o) =>
    o.kind === "participant" && "participantId" in o ? o.participantId : undefined,
  );
}

// ---------------------------------------------------------------------------
// The full lifecycle: create → roster → generate → publish → report → complete
// ---------------------------------------------------------------------------

test("a tournament runs end to end through the operations API", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);

  // Create (story 1–3): freeform discipline, single elimination, draft.
  const { tournamentId, shareSlug } = await as.mutation(api.operations.createTournament, {
    name: "  Friday Night Fights ",
    discipline: "Street Fighter 6",
    format: { family: "single_elimination" },
  });

  // Roster (stories 4–6): bulk paste with blank lines, one-by-one add,
  // rename, remove.
  const [aliceId] = await as.mutation(api.operations.addParticipants, {
    tournamentId,
    text: "Alice\n\n  Bob \nCarol\n",
  });
  const daveId = await as.mutation(api.operations.addParticipant, {
    tournamentId,
    name: "Dave",
  });
  await as.mutation(api.operations.renameParticipant, { participantId: daveId, name: "Dai" });
  const extraId = await as.mutation(api.operations.addParticipant, {
    tournamentId,
    name: "Typo",
  });
  await as.mutation(api.operations.removeParticipant, { participantId: extraId });

  let view = await as.query(api.operations.getTournament, { tournamentId });
  expect(view.name).toBe("Friday Night Fights");
  expect(view.status).toBe("draft");
  expect(view.discipline).toBe("Street Fighter 6");
  expect(view.participants.map((p) => p.name)).toEqual(["Alice", "Bob", "Carol", "Dai"]);
  expect(view.participants.map((p) => p.seed)).toEqual([1, 2, 3, 4]);
  expect(view.bracket).toBeNull();

  // Seeding (story 8): manual reorder, then generate (story 9).
  const bobId = view.participants.find((p) => p.name === "Bob")!.participantId;
  const carolId = view.participants.find((p) => p.name === "Carol")!.participantId;
  await as.mutation(api.operations.reorderSeeding, {
    tournamentId,
    orderedParticipantIds: [daveId, carolId, bobId, aliceId!],
  });
  await as.mutation(api.operations.generateBracket, { tournamentId });

  view = await as.query(api.operations.getTournament, { tournamentId });
  expect(view.seeding).toBe("manual");
  let bracket = bracketOf(view);
  // Standard placement for 4 seeds: (1 vs 4) and (2 vs 3).
  expect(occupantIds(matchAt(bracket, "winners", 1, 0))).toEqual([daveId, aliceId]);
  expect(occupantIds(matchAt(bracket, "winners", 1, 1))).toEqual([carolId, bobId]);
  expect(bracket.readyMatchKeys).toHaveLength(2);
  expect(bracket.completed).toBe(false);

  // Publish (story 11): draft → published, Share Link goes visible.
  expect(await t.query(api.operations.getSharedTournament, { shareSlug })).toBeNull();
  await as.mutation(api.operations.publishTournament, { tournamentId });
  const shared = await t.query(api.operations.getSharedTournament, { shareSlug });
  expect(shared).not.toBeNull();
  expect(shared!.status).toBe("published");

  // First result (story 12): published → live, roster and structure lock.
  const semiA = matchAt(bracket, "winners", 1, 0);
  const reportA = await as.mutation(api.operations.reportResult, {
    matchId: semiA.matchId,
    sides: [
      { participantId: daveId, outcome: "win", score: 2 },
      { participantId: aliceId!, outcome: "loss", score: 1 },
    ],
  });
  expect(reportA.status).toBe("live");
  expect(reportA.voided).toEqual([]);

  await expect(
    as.mutation(api.operations.addParticipant, { tournamentId, name: "Late" }),
  ).rejects.toThrow(/live/);
  await expect(as.mutation(api.operations.generateBracket, { tournamentId })).rejects.toThrow(
    /live/,
  );
  await expect(
    as.mutation(api.operations.reorderSeeding, {
      tournamentId,
      orderedParticipantIds: [aliceId!, bobId, carolId, daveId],
    }),
  ).rejects.toThrow(/live/);

  // Progress to the final: current/next matches come from readyMatchKeys
  // (story 15).
  const semiB = matchAt(bracket, "winners", 1, 1);
  await as.mutation(api.operations.reportResult, {
    matchId: semiB.matchId,
    sides: winOver(carolId, bobId),
  });
  view = await as.query(api.operations.getTournament, { tournamentId });
  bracket = bracketOf(view);
  const final = matchAt(bracket, "winners", 2, 0);
  expect(bracket.readyMatchKeys).toEqual([final.key]);
  expect(occupantIds(final)).toEqual([daveId, carolId]);
  expect(matchAt(bracket, "winners", 1, 0).sides).toEqual([
    { participantId: daveId, outcome: "win", score: 2 },
    { participantId: aliceId, outcome: "loss", score: 1 },
  ]);

  // Final result: automatic completion (story 16) and standings (story 23).
  const reportFinal = await as.mutation(api.operations.reportResult, {
    matchId: final.matchId,
    sides: winOver(daveId, carolId),
  });
  expect(reportFinal.status).toBe("completed");

  view = await as.query(api.operations.getTournament, { tournamentId });
  expect(view.status).toBe("completed");
  bracket = bracketOf(view);
  expect(bracket.completed).toBe(true);
  expect(bracket.championId).toBe(daveId);
  expect(bracket.standings).toEqual([
    { participantId: daveId, placement: 1 },
    { participantId: carolId, placement: 2 },
    ...[aliceId, bobId]
      .sort((a, b) => a!.localeCompare(b!))
      .map((participantId) => ({ participantId, placement: 3 })),
  ]);
});

// ---------------------------------------------------------------------------
// Correction → downstream void → re-entry (story 14, ADR 0005)
// ---------------------------------------------------------------------------

test("a correction voids downstream results, which are surfaced and re-enterable", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const { tournamentId, ids } = await seededTournament(as, names);
  await as.mutation(api.operations.publishTournament, { tournamentId });
  const id = (name: string) => ids.get(name)!;

  let view = await as.query(api.operations.getTournament, { tournamentId });
  let bracket = bracketOf(view);
  // Standard placement for 8 seeds: round 1 pairs (1v8), (4v5), (2v7), (3v6).
  const r1m0 = matchAt(bracket, "winners", 1, 0);
  const r1m1 = matchAt(bracket, "winners", 1, 1);
  expect(occupantIds(r1m0)).toEqual([id("A"), id("H")]);
  expect(occupantIds(r1m1)).toEqual([id("D"), id("E")]);

  await as.mutation(api.operations.reportResult, {
    matchId: r1m0.matchId,
    sides: winOver(id("A"), id("H")),
  });
  await as.mutation(api.operations.reportResult, {
    matchId: r1m1.matchId,
    sides: winOver(id("D"), id("E")),
  });

  view = await as.query(api.operations.getTournament, { tournamentId });
  bracket = bracketOf(view);
  const semi = matchAt(bracket, "winners", 2, 0);
  expect(occupantIds(semi)).toEqual([id("A"), id("D")]);
  await as.mutation(api.operations.reportResult, {
    matchId: semi.matchId,
    sides: winOver(id("A"), id("D")),
  });

  // Correct round 1: H actually beat A. The semifinal's recorded result
  // (A over D) no longer pairs — it is voided and reported back.
  const correction = await as.mutation(api.operations.reportResult, {
    matchId: r1m0.matchId,
    sides: winOver(id("H"), id("A")),
  });
  expect(correction.status).toBe("live");
  expect(correction.voided).toEqual([{ matchId: semi.matchId, matchKey: semi.key }]);

  // The derived view agrees: the semifinal is open again with the corrected
  // pairing, and flagged as awaiting re-entry.
  view = await as.query(api.operations.getTournament, { tournamentId });
  bracket = bracketOf(view);
  const reopenedSemi = matchAt(bracket, "winners", 2, 0);
  expect(reopenedSemi.state).toBe("ready");
  expect(occupantIds(reopenedSemi)).toEqual([id("H"), id("D")]);
  expect(bracket.voidedMatchKeys).toEqual([semi.key]);
  // The corrected-over round-1 record is superseded, not voided.
  expect(matchAt(bracket, "winners", 1, 0).winnerId).toBe(id("H"));

  // Reporting an unrelated match while the semifinal still awaits re-entry
  // reports nothing voided: the return value covers only what THIS append
  // invalidated; the outstanding void stays visible as voidedMatchKeys.
  const unrelated = await as.mutation(api.operations.reportResult, {
    matchId: matchAt(bracket, "winners", 1, 2).matchId,
    sides: winOver(id("B"), id("G")),
  });
  expect(unrelated.voided).toEqual([]);

  // Re-enter the semifinal; play continues with nothing else lost.
  const reentry = await as.mutation(api.operations.reportResult, {
    matchId: semi.matchId,
    sides: winOver(id("H"), id("D")),
  });
  expect(reentry.voided).toEqual([]);
  view = await as.query(api.operations.getTournament, { tournamentId });
  bracket = bracketOf(view);
  expect(bracket.voidedMatchKeys).toEqual([]);
  expect(matchAt(bracket, "winners", 2, 0).winnerId).toBe(id("H"));
});

test("corrections cannot reopen a completed tournament, but may refine it", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const { tournamentId, ids } = await seededTournament(as, ["A", "B", "C", "D"]);
  await as.mutation(api.operations.publishTournament, { tournamentId });
  const id = (name: string) => ids.get(name)!;

  const view = await as.query(api.operations.getTournament, { tournamentId });
  const bracket = bracketOf(view);
  const r1m0 = matchAt(bracket, "winners", 1, 0);
  const r1m1 = matchAt(bracket, "winners", 1, 1);
  const final = matchAt(bracket, "winners", 2, 0);
  await as.mutation(api.operations.reportResult, {
    matchId: r1m0.matchId,
    sides: winOver(id("A"), id("D")),
  });
  await as.mutation(api.operations.reportResult, {
    matchId: r1m1.matchId,
    sides: winOver(id("B"), id("C")),
  });
  const done = await as.mutation(api.operations.reportResult, {
    matchId: final.matchId,
    sides: winOver(id("A"), id("B")),
  });
  expect(done.status).toBe("completed");

  // A correction that would void the final (and so reopen play) is refused:
  // the lifecycle is one-way.
  await expect(
    as.mutation(api.operations.reportResult, {
      matchId: r1m0.matchId,
      sides: winOver(id("D"), id("A")),
    }),
  ).rejects.toThrow(/reopen/);

  // A correction that keeps the tournament completed (fixing the recorded
  // score of the final) is fine.
  const scoreFix = await as.mutation(api.operations.reportResult, {
    matchId: final.matchId,
    sides: [
      { participantId: id("A"), outcome: "win", score: 3 },
      { participantId: id("B"), outcome: "loss", score: 2 },
    ],
  });
  expect(scoreFix.status).toBe("completed");
  const after = await as.query(api.operations.getTournament, { tournamentId });
  expect(bracketOf(after).championId).toBe(id("A"));
});

// ---------------------------------------------------------------------------
// Walkovers (story 13) and outcome validation
// ---------------------------------------------------------------------------

test("a no-show is a walkover result; the bracket advances without regeneration", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const { tournamentId, ids } = await seededTournament(as, ["A", "B"]);
  await as.mutation(api.operations.publishTournament, { tournamentId });

  const report = await as.mutation(api.operations.reportResult, {
    matchId: matchAt(
      bracketOf(await as.query(api.operations.getTournament, { tournamentId })),
      "winners",
      1,
      0,
    ).matchId,
    sides: winOver(ids.get("A")!, ids.get("B")!, "walkover"),
  });
  // A 2-participant bracket completes on its first (walkover) result:
  // published → live → completed in one report.
  expect(report.status).toBe("completed");
  const view = await as.query(api.operations.getTournament, { tournamentId });
  expect(bracketOf(view).championId).toBe(ids.get("A"));
});

test("invalid results are refused with the engine's reasons", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const { tournamentId, ids } = await seededTournament(as, ["A", "B", "C", "D"]);
  await as.mutation(api.operations.publishTournament, { tournamentId });
  const id = (name: string) => ids.get(name)!;
  const view = await as.query(api.operations.getTournament, { tournamentId });
  const bracket = bracketOf(view);
  const r1m0 = matchAt(bracket, "winners", 1, 0);
  const final = matchAt(bracket, "winners", 2, 0);

  // Draws are not allowed under elimination.
  await expect(
    as.mutation(api.operations.reportResult, {
      matchId: r1m0.matchId,
      sides: [
        { participantId: id("A"), outcome: "draw" },
        { participantId: id("D"), outcome: "draw" },
      ],
    }),
  ).rejects.toThrow(/draw/);

  // Both sides must be the match's current occupants.
  await expect(
    as.mutation(api.operations.reportResult, {
      matchId: r1m0.matchId,
      sides: winOver(id("A"), id("B")),
    }),
  ).rejects.toThrow(/does not apply/);

  // A pending match (occupants undetermined) cannot take a result.
  await expect(
    as.mutation(api.operations.reportResult, {
      matchId: final.matchId,
      sides: winOver(id("A"), id("B")),
    }),
  ).rejects.toThrow(/does not apply/);

  // Exactly two sides.
  await expect(
    as.mutation(api.operations.reportResult, {
      matchId: r1m0.matchId,
      sides: [{ participantId: id("A"), outcome: "win" }],
    }),
  ).rejects.toThrow(/two sides/);
});

// ---------------------------------------------------------------------------
// Seeding and regeneration (stories 7–10)
// ---------------------------------------------------------------------------

test("random seeding assigns a 1..n permutation and pairs by standard placement", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const { tournamentId } = await as.mutation(api.operations.createTournament, {
    name: "Shuffled",
    discipline: "Tekken 8",
    format: { family: "single_elimination" },
  });
  await as.mutation(api.operations.addParticipants, { tournamentId, text: names.join("\n") });
  await as.mutation(api.operations.generateBracket, { tournamentId });

  const view = await as.query(api.operations.getTournament, { tournamentId });
  expect(view.seeding).toBe("random");
  expect(view.participants.map((p) => p.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(view.participants.map((p) => p.name).sort()).toEqual(names);

  // Whatever the shuffle produced, the bracket pairs those seeds by standard
  // placement: (1v8), (4v5), (2v7), (3v6).
  const bySeed = new Map(view.participants.map((p) => [p.seed, p.participantId]));
  const bracket = bracketOf(view);
  expect(occupantIds(matchAt(bracket, "winners", 1, 0))).toEqual([bySeed.get(1), bySeed.get(8)]);
  expect(occupantIds(matchAt(bracket, "winners", 1, 1))).toEqual([bySeed.get(4), bySeed.get(5)]);
  expect(occupantIds(matchAt(bracket, "winners", 1, 2))).toEqual([bySeed.get(2), bySeed.get(7)]);
  expect(occupantIds(matchAt(bracket, "winners", 1, 3))).toEqual([bySeed.get(3), bySeed.get(6)]);
});

test("roster changes invalidate a generated bracket; regeneration picks them up", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const { tournamentId } = await seededTournament(as, ["A", "B", "C", "D"]);

  // A rename does not touch the structure.
  let view = await as.query(api.operations.getTournament, { tournamentId });
  await as.mutation(api.operations.renameParticipant, {
    participantId: view.participants[0]!.participantId,
    name: "Ace",
  });
  view = await as.query(api.operations.getTournament, { tournamentId });
  expect(view.bracket).not.toBeNull();

  // Adding a participant drops the stale bracket until regeneration.
  const lateId = await as.mutation(api.operations.addParticipant, {
    tournamentId,
    name: "Late",
  });
  view = await as.query(api.operations.getTournament, { tournamentId });
  expect(view.bracket).toBeNull();

  await as.mutation(api.operations.generateBracket, { tournamentId });
  view = await as.query(api.operations.getTournament, { tournamentId });
  const bracket = bracketOf(view);
  const seeded = bracket.matches.flatMap((m) =>
    m.occupants.flatMap((o) => (o.kind === "participant" ? [o.participantId] : [])),
  );
  expect(seeded).toContain(lateId);
});

test("roster edits and regeneration stay available while published, until the first result", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const { tournamentId, shareSlug } = await seededTournament(as, ["A", "B", "C", "D"]);
  await as.mutation(api.operations.publishTournament, { tournamentId });

  // A late roster change (story 10) drops the published bracket...
  await as.mutation(api.operations.addParticipant, { tournamentId, name: "E" });
  let shared = await t.query(api.operations.getSharedTournament, { shareSlug });
  expect(shared!.status).toBe("published");
  expect(shared!.bracket).toBeNull();

  // ...and regeneration restores it, still published, roster of five.
  await as.mutation(api.operations.generateBracket, { tournamentId });
  shared = await t.query(api.operations.getSharedTournament, { shareSlug });
  expect(shared!.status).toBe("published");
  expect(bracketOf(shared!).matches.length).toBeGreaterThan(0);
  expect(shared!.participants).toHaveLength(5);
});

test("bracket generation needs a roster of at least two", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const { tournamentId } = await as.mutation(api.operations.createTournament, {
    name: "Tiny",
    discipline: "Chess",
    format: { family: "single_elimination" },
  });
  await expect(as.mutation(api.operations.generateBracket, { tournamentId })).rejects.toThrow(
    /two participants/,
  );
  await as.mutation(api.operations.addParticipant, { tournamentId, name: "Solo" });
  await expect(as.mutation(api.operations.generateBracket, { tournamentId })).rejects.toThrow(
    /two participants/,
  );
});

test("reorderSeeding requires a complete permutation of the roster", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const { tournamentId, ids } = await seededTournament(as, ["A", "B", "C"]);
  await expect(
    as.mutation(api.operations.reorderSeeding, {
      tournamentId,
      orderedParticipantIds: [ids.get("A")!, ids.get("B")!],
    }),
  ).rejects.toThrow(/every participant/);
  await expect(
    as.mutation(api.operations.reorderSeeding, {
      tournamentId,
      orderedParticipantIds: [ids.get("A")!, ids.get("B")!, ids.get("B")!],
    }),
  ).rejects.toThrow(/every participant/);
});

// ---------------------------------------------------------------------------
// Formats (story 3)
// ---------------------------------------------------------------------------

test("double elimination defaults to grand-final reset on and generates all sections", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const { tournamentId } = await seededTournament(as, ["A", "B", "C", "D"], {
    family: "double_elimination",
  });
  const view = await as.query(api.operations.getTournament, { tournamentId });
  expect(view.format).toEqual({ family: "double_elimination", grandFinalReset: true });
  const sections = new Set(bracketOf(view).matches.map((m) => m.bracket));
  expect(sections).toEqual(new Set(["winners", "losers", "grand_final"]));
});

// ---------------------------------------------------------------------------
// Lifecycle status enforcement
// ---------------------------------------------------------------------------

test("publishing requires a draft with a generated bracket", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const { tournamentId } = await as.mutation(api.operations.createTournament, {
    name: "Unready",
    discipline: "Chess",
    format: { family: "single_elimination" },
  });
  await expect(as.mutation(api.operations.publishTournament, { tournamentId })).rejects.toThrow(
    /Generate the bracket/,
  );
  await as.mutation(api.operations.addParticipants, { tournamentId, text: "A\nB" });
  await as.mutation(api.operations.generateBracket, { tournamentId });
  await as.mutation(api.operations.publishTournament, { tournamentId });
  await expect(as.mutation(api.operations.publishTournament, { tournamentId })).rejects.toThrow(
    /published/,
  );
});

test("results cannot be recorded on a draft", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const { tournamentId, ids } = await seededTournament(as, ["A", "B"]);
  const view = await as.query(api.operations.getTournament, { tournamentId });
  const final = matchAt(bracketOf(view), "winners", 1, 0);
  await expect(
    as.mutation(api.operations.reportResult, {
      matchId: final.matchId,
      sides: winOver(ids.get("A")!, ids.get("B")!),
    }),
  ).rejects.toThrow(/draft/);
});

// ---------------------------------------------------------------------------
// Authorization (ADR 0003): unauthenticated and foreign callers are refused
// ---------------------------------------------------------------------------

test("organizer operations refuse unauthenticated callers", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const { tournamentId, ids } = await seededTournament(as, ["A", "B"]);

  await expect(
    t.mutation(api.operations.createTournament, {
      name: "Nope",
      discipline: "Chess",
      format: { family: "single_elimination" },
    }),
  ).rejects.toThrow(/Not signed in/);
  await expect(
    t.mutation(api.operations.addParticipant, { tournamentId, name: "X" }),
  ).rejects.toThrow(/Not signed in/);
  await expect(t.query(api.operations.getTournament, { tournamentId })).rejects.toThrow(
    /Not signed in/,
  );
  await expect(t.query(api.operations.listMyTournaments, {})).rejects.toThrow(/Not signed in/);
  const view = await as.query(api.operations.getTournament, { tournamentId });
  await expect(
    t.mutation(api.operations.reportResult, {
      matchId: matchAt(bracketOf(view), "winners", 1, 0).matchId,
      sides: winOver(ids.get("A")!, ids.get("B")!),
    }),
  ).rejects.toThrow(/Not signed in/);
  // Identity is resolved before any document lookup, so an unauthenticated
  // probe cannot distinguish existing ids from missing ones.
  await expect(
    t.mutation(api.operations.renameParticipant, { participantId: ids.get("A")!, name: "X" }),
  ).rejects.toThrow(/Not signed in/);
});

test("another organizer's tournament is untouchable and reads as not found", async () => {
  const t = convexTest(schema, modules);
  const { as: owner } = await newOrganizer(t);
  const { as: intruder } = await newOrganizer(t);
  const { tournamentId, ids } = await seededTournament(owner, ["A", "B"]);
  await owner.mutation(api.operations.publishTournament, { tournamentId });
  const view = await owner.query(api.operations.getTournament, { tournamentId });
  const final = matchAt(bracketOf(view), "winners", 1, 0);

  await expect(intruder.query(api.operations.getTournament, { tournamentId })).rejects.toThrow(
    /not found/,
  );
  await expect(
    intruder.mutation(api.operations.addParticipant, { tournamentId, name: "X" }),
  ).rejects.toThrow(/not found/);
  await expect(intruder.mutation(api.operations.generateBracket, { tournamentId })).rejects.toThrow(
    /not found/,
  );
  await expect(
    intruder.mutation(api.operations.publishTournament, { tournamentId }),
  ).rejects.toThrow(/not found/);
  await expect(
    intruder.mutation(api.operations.reportResult, {
      matchId: final.matchId,
      sides: winOver(ids.get("A")!, ids.get("B")!),
    }),
  ).rejects.toThrow(/not found/);
  await expect(
    intruder.mutation(api.operations.removeParticipant, { participantId: ids.get("A")! }),
  ).rejects.toThrow(/not found/);

  // The owner's state is intact and the intruder's list is empty.
  const intact = await owner.query(api.operations.getTournament, { tournamentId });
  expect(intact.participants).toHaveLength(2);
  expect(await intruder.query(api.operations.listMyTournaments, {})).toEqual([]);

  // A foreign document and a missing one read identically, so probing ids
  // confirms nothing about their existence.
  const foreignError = intruder.mutation(api.operations.renameParticipant, {
    participantId: ids.get("A")!,
    name: "X",
  });
  await expect(foreignError).rejects.toThrow(/Participant not found/);
  await t.run(async (ctx) => await ctx.db.delete("participants", ids.get("B")!));
  const missingError = intruder.mutation(api.operations.renameParticipant, {
    participantId: ids.get("B")!,
    name: "X",
  });
  await expect(missingError).rejects.toThrow(/Participant not found/);
});

// ---------------------------------------------------------------------------
// The Share Link's public read (stories 17, 21–23)
// ---------------------------------------------------------------------------

test("the share link works without auth, hides drafts, and leaks nothing organizer-only", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newOrganizer(t);
  const { tournamentId, shareSlug, ids } = await seededTournament(as, ["A", "B", "C", "D"]);

  // Unknown slugs and drafts both read as null.
  expect(await t.query(api.operations.getSharedTournament, { shareSlug: "nosuchslug00" })).toBe(
    null,
  );
  expect(await t.query(api.operations.getSharedTournament, { shareSlug })).toBeNull();

  await as.mutation(api.operations.publishTournament, { tournamentId });
  const view = await as.query(api.operations.getTournament, { tournamentId });
  await as.mutation(api.operations.reportResult, {
    matchId: matchAt(bracketOf(view), "winners", 1, 0).matchId,
    sides: winOver(ids.get("A")!, ids.get("D")!),
  });

  // Spectators (no identity at all) see the live bracket, results, and
  // standings...
  const shared = await t.query(api.operations.getSharedTournament, { shareSlug });
  expect(shared).not.toBeNull();
  expect(shared!.status).toBe("live");
  const sharedBracket = bracketOf(shared!);
  expect(matchAt(sharedBracket, "winners", 1, 0).winnerId).toBe(ids.get("A"));
  expect(sharedBracket.standings.length).toBe(4);

  // ...but nothing organizer-only: no organizer id, no actor trail, no slug
  // echo, and no document handles (tournament or match) — public matches are
  // identified by their structural key only.
  const serialized = JSON.stringify(shared);
  expect(serialized).not.toContain(userId);
  expect(serialized).not.toContain("organizerId");
  expect(serialized).not.toContain("recordedBy");
  expect(serialized).not.toContain("shareSlug");
  expect(serialized).not.toContain(tournamentId);
  expect(serialized).not.toContain("matchId");
});

test("the share link respects the visibility field", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const { tournamentId, shareSlug } = await seededTournament(as, ["A", "B"]);
  await as.mutation(api.operations.publishTournament, { tournamentId });
  expect(await t.query(api.operations.getSharedTournament, { shareSlug })).not.toBeNull();

  // No MVP mutation can set "private", but the public gate must already
  // honor it so exposing the field later cannot leak by omission.
  await t.run(async (ctx) => ctx.db.patch("tournaments", tournamentId, { visibility: "private" }));
  expect(await t.query(api.operations.getSharedTournament, { shareSlug })).toBeNull();
});

test("writes are bounded: roster size, name length, and scores", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  const { tournamentId, ids } = await seededTournament(as, ["A", "B"]);

  await expect(
    as.mutation(api.operations.addParticipants, {
      tournamentId,
      text: Array.from({ length: 127 }, (_, i) => `P${i}`).join("\n"),
    }),
  ).rejects.toThrow(/at most 128 participants/);
  await expect(
    as.mutation(api.operations.addParticipant, { tournamentId, name: "x".repeat(121) }),
  ).rejects.toThrow(/at most 120 characters/);

  await as.mutation(api.operations.publishTournament, { tournamentId });
  const view = await as.query(api.operations.getTournament, { tournamentId });
  await expect(
    as.mutation(api.operations.reportResult, {
      matchId: matchAt(bracketOf(view), "winners", 1, 0).matchId,
      sides: [
        { participantId: ids.get("A")!, outcome: "win", score: Number.NaN },
        { participantId: ids.get("B")!, outcome: "loss" },
      ],
    }),
  ).rejects.toThrow(/finite/);
});

// ---------------------------------------------------------------------------
// Disciplines (story 2)
// ---------------------------------------------------------------------------

test("disciplines deduplicate on their normalized form and feed suggestions", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newOrganizer(t);
  await as.mutation(api.operations.createTournament, {
    name: "First",
    discipline: "Street Fighter 6",
    format: { family: "single_elimination" },
  });
  await as.mutation(api.operations.createTournament, {
    name: "Second",
    discipline: "  street   FIGHTER 6 ",
    format: { family: "single_elimination" },
  });
  await as.mutation(api.operations.createTournament, {
    name: "Third",
    discipline: "Strive",
    format: { family: "single_elimination" },
  });

  const disciplines = await t.run(async (ctx) => await ctx.db.query("disciplines").collect());
  expect(disciplines.map((d) => d.name).sort()).toEqual(["Street Fighter 6", "Strive"]);

  // Suggestions are a public prefix search over the normalized form.
  expect(await t.query(api.operations.suggestDisciplines, { prefix: "STREET f" })).toEqual([
    "Street Fighter 6",
  ]);
  expect(await t.query(api.operations.suggestDisciplines, { prefix: "str" })).toEqual([
    "Street Fighter 6",
    "Strive",
  ]);
  expect(await t.query(api.operations.suggestDisciplines, { prefix: "  " })).toEqual([]);
});

// ---------------------------------------------------------------------------
// Organizer's tournament list
// ---------------------------------------------------------------------------

test("listMyTournaments returns only the caller's tournaments, newest first", async () => {
  const t = convexTest(schema, modules);
  const { as: one } = await newOrganizer(t);
  const { as: two } = await newOrganizer(t);
  const first = await one.mutation(api.operations.createTournament, {
    name: "First",
    discipline: "Chess",
    format: { family: "single_elimination" },
  });
  const second = await one.mutation(api.operations.createTournament, {
    name: "Second",
    discipline: "Go",
    format: { family: "double_elimination" },
  });
  await two.mutation(api.operations.createTournament, {
    name: "Other",
    discipline: "Chess",
    format: { family: "single_elimination" },
  });

  const mine = await one.query(api.operations.listMyTournaments, {});
  expect(mine.map((row) => row.name)).toEqual(["Second", "First"]);
  expect(mine[0]).toEqual({
    tournamentId: second.tournamentId,
    name: "Second",
    status: "draft",
    format: { family: "double_elimination", grandFinalReset: true },
    discipline: "Go",
    shareSlug: second.shareSlug,
  });
  expect(mine[1]!.tournamentId).toBe(first.tournamentId);
});
