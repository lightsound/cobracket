import { describe, expect, test } from "bun:test";

import { deriveProgression, generateBracket } from "./index";
import type { RecordedResult } from "./index";

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

// Corrections append a newer record for the same match (ADR 0005); the
// latest record per match is the effective one, and downstream records
// whose pairing the correction invalidates become void.
describe("corrections and downstream voiding", () => {
  const structure = () =>
    generateBracket(["p1", "p2", "p3", "p4"], {
      family: "single_elimination",
    });

  function playedOut() {
    const generated = structure();
    const [semi1, semi2] = deriveProgression(generated, []).readyMatchKeys;
    const semis = [winOver(semi1!, "p1", "p4"), winOver(semi2!, "p2", "p3")];
    const [finalKey] = deriveProgression(generated, semis).readyMatchKeys;
    return {
      generated,
      semi1: semi1!,
      semi2: semi2!,
      finalKey: finalKey!,
      results: [...semis, winOver(finalKey!, "p1", "p2")],
    };
  }

  test("correcting a semifinal voids the final played under the old pairing", () => {
    const { generated, semi2, finalKey, results } = playedOut();

    // The tournament had completed with p1 as champion.
    expect(deriveProgression(generated, results).completed).toBe(true);

    // Rounds later: the second semifinal actually went to p3, not p2.
    const corrected = [...results, winOver(semi2, "p3", "p2")];
    const progression = deriveProgression(generated, corrected);

    expect(progression.completed).toBe(false);
    expect(progression.championId).toBeUndefined();
    // The final's recorded p1-vs-p2 result no longer matches its p1-vs-p3
    // pairing: void, awaiting re-entry.
    expect(progression.voidedResultIndices).toEqual([2]);
    expect(progression.readyMatchKeys).toEqual([finalKey]);

    const finalMatch = progression.matches.find(
      (match) => match.key === finalKey,
    );
    const occupantIds = finalMatch?.occupants
      .map((occupant) =>
        occupant.kind === "participant" ? occupant.participantId : "?",
      )
      .sort();
    expect(occupantIds).toEqual(["p1", "p3"]);
  });

  test("re-entering the voided match completes the tournament again", () => {
    const { generated, semi2, finalKey, results } = playedOut();
    const corrected = [
      ...results,
      winOver(semi2, "p3", "p2"),
      winOver(finalKey, "p3", "p1"),
    ];

    const progression = deriveProgression(generated, corrected);

    expect(progression.completed).toBe(true);
    expect(progression.championId).toBe("p3");
    expect(progression.voidedResultIndices).toEqual([]);
    expect(progression.standings).toEqual([
      { participantId: "p3", placement: 1 },
      { participantId: "p1", placement: 2 },
      { participantId: "p2", placement: 3 },
      { participantId: "p4", placement: 3 },
    ]);
  });

  test("a correction that keeps the winner leaves downstream results standing", () => {
    const { generated, semi1, results } = playedOut();

    // Same winner, corrected score detail: the final's pairing still holds.
    const corrected: RecordedResult[] = [
      ...results,
      {
        matchKey: semi1,
        sides: [
          { participantId: "p1", outcome: "win", score: 2 },
          { participantId: "p4", outcome: "loss", score: 1 },
        ],
      },
    ];
    const progression = deriveProgression(generated, corrected);

    expect(progression.completed).toBe(true);
    expect(progression.championId).toBe("p1");
    expect(progression.voidedResultIndices).toEqual([]);
  });

  test("only the latest record per match is effective", () => {
    const generated = generateBracket(["p1", "p2"], {
      family: "single_elimination",
    });
    const [finalKey] = deriveProgression(generated, []).readyMatchKeys;

    const progression = deriveProgression(generated, [
      winOver(finalKey!, "p1", "p2"),
      winOver(finalKey!, "p2", "p1"),
    ]);

    expect(progression.championId).toBe("p2");
    // The superseded record is history, not a void needing re-entry.
    expect(progression.voidedResultIndices).toEqual([]);
  });
});
