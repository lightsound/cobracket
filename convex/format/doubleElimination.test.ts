import { describe, expect, test } from "bun:test";

import { deriveProgression, generateBracket } from "./index";
import type { Progression, RecordedResult } from "./index";

function winOver(
  matchKey: string,
  winner: string,
  loser: string,
): RecordedResult {
  return {
    matchKey,
    sides: [
      { participantId: winner, outcome: "win" },
      { participantId: loser, outcome: "loss" },
    ],
  };
}

// Plays ready matches one at a time, deciding each by participant preference.
function play(
  progressionOf: (results: RecordedResult[]) => Progression,
  pickWinner: (a: string, b: string) => string,
): { progression: Progression; results: RecordedResult[] } {
  const results: RecordedResult[] = [];
  for (let guard = 0; guard < 1000; guard++) {
    const progression = progressionOf(results);
    const [nextKey] = progression.readyMatchKeys;
    if (nextKey === undefined) {
      return { progression, results };
    }
    const match = progression.matches.find((m) => m.key === nextKey)!;
    const [a, b] = match.occupants.map((occupant) => {
      if (occupant.kind !== "participant") {
        throw new Error("ready match with a non-participant occupant");
      }
      return occupant.participantId;
    });
    const winner = pickWinner(a!, b!);
    results.push(winOver(nextKey, winner, winner === a ? b! : a!));
  }
  throw new Error("tournament did not complete");
}

const lowerNumberWins = (a: string, b: string) =>
  Number(a.slice(1)) < Number(b.slice(1)) ? a : b;

describe("double elimination with four participants", () => {
  const structure = () =>
    generateBracket(["p1", "p2", "p3", "p4"], {
      family: "double_elimination",
      grandFinalReset: true,
    });

  test("losing once drops into the losers bracket, not out", () => {
    const generated = structure();
    const opening = deriveProgression(generated, []);
    expect(opening.readyMatchKeys).toHaveLength(2);

    // p1 beats p4, p2 beats p3: both losers stay in contention.
    const [open1, open2] = opening.readyMatchKeys;
    const afterOpeners = deriveProgression(generated, [
      winOver(open1!, "p1", "p4"),
      winOver(open2!, "p2", "p3"),
    ]);

    // Winners semifinal (p1 vs p2) and losers opener (p4 vs p3) both ready.
    expect(afterOpeners.readyMatchKeys).toHaveLength(2);
    const readyOccupants = afterOpeners.readyMatchKeys.map((key) =>
      afterOpeners.matches
        .find((m) => m.key === key)!
        .occupants.map((o) =>
          o.kind === "participant" ? o.participantId : "?",
        )
        .sort(),
    );
    expect(readyOccupants).toContainEqual(["p1", "p2"]);
    expect(readyOccupants).toContainEqual(["p3", "p4"]);
  });

  test("winners-side champion winning the grand final ends it without a reset", () => {
    const { progression, results } = play(
      (results) => deriveProgression(structure(), results),
      lowerNumberWins,
    );

    expect(progression.completed).toBe(true);
    expect(progression.championId).toBe("p1");
    // Everyone but the champion lost exactly twice... except the grand
    // final loser, who exits on their second loss too: 2n - 2 matches.
    expect(results).toHaveLength(6);
    expect(progression.standings).toEqual([
      { participantId: "p1", placement: 1 },
      { participantId: "p2", placement: 2 },
      { participantId: "p3", placement: 3 },
      { participantId: "p4", placement: 4 },
    ]);
    // The reset match is structurally unnecessary: cancelled, not pending.
    const cancelled = progression.matches.filter(
      (m) => m.state === "cancelled",
    );
    expect(cancelled).toHaveLength(1);
  });

  test("losers-side finalist winning the grand final forces the bracket reset", () => {
    const generated = structure();
    // p1 and p2 reach the winners final; p1 wins it. p2 drops, returns
    // through the losers bracket, and beats p1 in the grand final.
    const { results: preset } = play(
      (results) => deriveProgression(generated, results),
      lowerNumberWins,
    );
    // Replay: take the same bracket but let p2 win the grand final.
    const withoutGrandFinal = preset.slice(0, -1);
    const beforeReset = deriveProgression(generated, withoutGrandFinal);
    const [grandFinalKey] = beforeReset.readyMatchKeys;
    const afterUpset = deriveProgression(generated, [
      ...withoutGrandFinal,
      winOver(grandFinalKey!, "p2", "p1"),
    ]);

    // Not over: p1 has only lost once. The reset match is now ready.
    expect(afterUpset.completed).toBe(false);
    expect(afterUpset.championId).toBeUndefined();
    expect(afterUpset.readyMatchKeys).toHaveLength(1);

    const [resetKey] = afterUpset.readyMatchKeys;
    const done = deriveProgression(generated, [
      ...withoutGrandFinal,
      winOver(grandFinalKey!, "p2", "p1"),
      winOver(resetKey!, "p2", "p1"),
    ]);
    expect(done.completed).toBe(true);
    expect(done.championId).toBe("p2");
    expect(done.standings).toEqual([
      { participantId: "p2", placement: 1 },
      { participantId: "p1", placement: 2 },
      { participantId: "p3", placement: 3 },
      { participantId: "p4", placement: 4 },
    ]);
  });

  test("the winners-side finalist can save the title in the reset", () => {
    const generated = structure();
    const { results: preset } = play(
      (results) => deriveProgression(generated, results),
      lowerNumberWins,
    );
    const withoutGrandFinal = preset.slice(0, -1);
    const [grandFinalKey] = deriveProgression(generated, withoutGrandFinal)
      .readyMatchKeys;
    const upset = [...withoutGrandFinal, winOver(grandFinalKey!, "p2", "p1")];
    const [resetKey] = deriveProgression(generated, upset).readyMatchKeys;

    const done = deriveProgression(generated, [
      ...upset,
      winOver(resetKey!, "p1", "p2"),
    ]);

    expect(done.completed).toBe(true);
    expect(done.championId).toBe("p1");
    expect(done.standings[0]).toEqual({ participantId: "p1", placement: 1 });
    expect(done.standings[1]).toEqual({ participantId: "p2", placement: 2 });
  });
});

describe("double elimination without the bracket reset", () => {
  test("the grand final alone decides the title", () => {
    const generated = generateBracket(["p1", "p2", "p3", "p4"], {
      family: "double_elimination",
      grandFinalReset: false,
    });
    const { results: preset } = play(
      (results) => deriveProgression(generated, results),
      lowerNumberWins,
    );
    const withoutGrandFinal = preset.slice(0, -1);
    const [grandFinalKey] = deriveProgression(generated, withoutGrandFinal)
      .readyMatchKeys;

    const done = deriveProgression(generated, [
      ...withoutGrandFinal,
      winOver(grandFinalKey!, "p2", "p1"),
    ]);

    expect(done.completed).toBe(true);
    expect(done.championId).toBe("p2");
  });
});

describe("double elimination byes (five participants)", () => {
  test("byes propagate into the losers bracket without phantom matches", () => {
    const generated = generateBracket(["p1", "p2", "p3", "p4", "p5"], {
      family: "double_elimination",
      grandFinalReset: true,
    });

    const { progression, results } = play(
      (results) => deriveProgression(generated, results),
      lowerNumberWins,
    );

    expect(progression.completed).toBe(true);
    expect(progression.championId).toBe("p1");
    // 2n - 2 real matches when the winners-side finalist takes the title.
    expect(results).toHaveLength(8);
    expect(progression.standings).toHaveLength(5);
    // No match should ever have been ready with a bye in it.
    for (const result of results) {
      expect(result.sides).toHaveLength(2);
    }
  });
});

describe("double elimination corrections", () => {
  test("correcting the winners final voids downstream losers-bracket play", () => {
    const generated = generateBracket(["p1", "p2", "p3", "p4"], {
      family: "double_elimination",
      grandFinalReset: true,
    });
    const { results } = play(
      (results) => deriveProgression(generated, results),
      lowerNumberWins,
    );
    const done = deriveProgression(generated, results);
    expect(done.completed).toBe(true);

    // Flip the winners final (p1 vs p2): p2 actually won it.
    const winnersFinal = done.matches.find(
      (m) => m.bracket === "winners" && m.round === 2,
    )!;
    const corrected = [...results, winOver(winnersFinal.key, "p2", "p1")];
    const progression = deriveProgression(generated, corrected);

    // The losers final and grand final were played under pairings that no
    // longer hold: they void and the tournament reopens.
    expect(progression.completed).toBe(false);
    expect(progression.voidedResultIndices.length).toBeGreaterThan(0);
    expect(progression.readyMatchKeys.length).toBeGreaterThan(0);
  });
});

describe("double elimination walkovers", () => {
  test("a walkover loser still drops to the losers bracket and can be walkovered out", () => {
    const generated = generateBracket(["p1", "p2", "p3", "p4"], {
      family: "double_elimination",
      grandFinalReset: true,
    });
    const opening = deriveProgression(generated, []);
    const openerOf = (participantId: string) =>
      opening.readyMatchKeys.find((key) =>
        opening.matches
          .find((m) => m.key === key)!
          .occupants.some(
            (o) => o.kind === "participant" && o.participantId === participantId,
          ),
      )!;

    // p4 no-shows their opener; the published bracket is never regenerated
    // (CONTEXT.md "Walkover"): p4 drops to the losers bracket, and the
    // organizer records a second walkover there when p4 stays absent.
    const results: RecordedResult[] = [
      {
        matchKey: openerOf("p4"),
        sides: [
          { participantId: "p1", outcome: "win" },
          { participantId: "p4", outcome: "walkover" },
        ],
      },
      winOver(openerOf("p3"), "p2", "p3"),
    ];
    const midway = deriveProgression(generated, results);
    const losersOpener = midway.matches.find(
      (m) => m.bracket === "losers" && m.state === "ready",
    )!;
    expect(
      losersOpener.occupants.map((o) =>
        o.kind === "participant" ? o.participantId : "?",
      ),
    ).toContain("p4");

    const done = deriveProgression(generated, [
      ...results,
      {
        matchKey: losersOpener.key,
        sides: [
          { participantId: "p3", outcome: "win" },
          { participantId: "p4", outcome: "walkover" },
        ],
      },
    ]);
    const p4 = done.standings.find((s) => s.participantId === "p4");
    expect(p4?.placement).toBe(4);
  });
});
