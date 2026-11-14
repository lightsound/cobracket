import { describe, expect, test } from "vite-plus/test";

import { deriveProgression, generateBracket } from "./index";
import type { RecordedResult } from "./index";

function winOver(matchKey: string, winner: string, loser: string): RecordedResult {
  return {
    matchKey,
    sides: [
      { participantId: winner, outcome: "win" },
      { participantId: loser, outcome: "loss" },
    ],
  };
}

describe("single elimination with two participants", () => {
  const structure = () => generateBracket(["p1", "p2"], { family: "single_elimination" });

  test("generates one immediately ready match", () => {
    const progression = deriveProgression(structure(), []);

    expect(progression.readyMatchKeys).toHaveLength(1);
    expect(progression.completed).toBe(false);
    expect(progression.championId).toBeUndefined();
  });

  test("a win completes the tournament with final standings", () => {
    const generated = structure();
    const [finalKey] = deriveProgression(generated, []).readyMatchKeys;

    const progression = deriveProgression(generated, [winOver(finalKey!, "p1", "p2")]);

    expect(progression.completed).toBe(true);
    expect(progression.championId).toBe("p1");
    expect(progression.readyMatchKeys).toHaveLength(0);
    expect(progression.standings).toEqual([
      { participantId: "p1", placement: 1 },
      { participantId: "p2", placement: 2 },
    ]);
  });
});

describe("single elimination with four participants", () => {
  const structure = () =>
    generateBracket(["p1", "p2", "p3", "p4"], {
      family: "single_elimination",
    });

  test("two matches are ready at the start and the final is pending", () => {
    const progression = deriveProgression(structure(), []);

    expect(progression.readyMatchKeys).toHaveLength(2);
    expect(progression.matches).toHaveLength(3);
    expect(progression.matches.filter((match) => match.state === "pending")).toHaveLength(1);
  });

  test("seeds 1 and 2 are placed to meet only in the final", () => {
    const progression = deriveProgression(structure(), []);
    const openers = progression.matches.filter((match) => match.round === 1);
    const pairings = openers.map((match) =>
      match.occupants
        .map((occupant) => (occupant.kind === "participant" ? occupant.participantId : "?"))
        .sort(),
    );

    expect(pairings).toContainEqual(["p1", "p4"]);
    expect(pairings).toContainEqual(["p2", "p3"]);
  });

  test("semifinal winners meet in the final; losers tie for third", () => {
    const generated = structure();
    const [semi1, semi2] = deriveProgression(generated, []).readyMatchKeys;
    const afterSemis = [winOver(semi1!, "p1", "p4"), winOver(semi2!, "p2", "p3")];

    const beforeFinal = deriveProgression(generated, afterSemis);
    expect(beforeFinal.readyMatchKeys).toHaveLength(1);
    expect(beforeFinal.completed).toBe(false);

    const [finalKey] = beforeFinal.readyMatchKeys;
    const done = deriveProgression(generated, [...afterSemis, winOver(finalKey!, "p2", "p1")]);

    expect(done.completed).toBe(true);
    expect(done.championId).toBe("p2");
    expect(done.standings).toEqual([
      { participantId: "p2", placement: 1 },
      { participantId: "p1", placement: 2 },
      { participantId: "p3", placement: 3 },
      { participantId: "p4", placement: 3 },
    ]);
  });
});

describe("single elimination byes (non-power-of-two rosters)", () => {
  test("three participants: the top seed gets the bye and waits", () => {
    const generated = generateBracket(["p1", "p2", "p3"], {
      family: "single_elimination",
    });
    const progression = deriveProgression(generated, []);

    // Only p2 vs p3 is playable; p1's opener resolved structurally.
    expect(progression.readyMatchKeys).toHaveLength(1);
    const byeMatch = progression.matches.find(
      (match) => match.round === 1 && match.state === "completed",
    );
    expect(byeMatch?.winnerId).toBe("p1");
    expect(byeMatch?.loserId).toBeUndefined();

    const [openerKey] = progression.readyMatchKeys;
    const done = deriveProgression(generated, [
      winOver(openerKey!, "p3", "p2"),
      winOver("w2m1", "p1", "p3"),
    ]);
    expect(done.completed).toBe(true);
    expect(done.championId).toBe("p1");
    expect(done.standings).toEqual([
      { participantId: "p1", placement: 1 },
      { participantId: "p3", placement: 2 },
      { participantId: "p2", placement: 3 },
    ]);
  });

  test("a bye never counts as a participant in standings", () => {
    const generated = generateBracket(["p1", "p2", "p3"], {
      family: "single_elimination",
    });
    const progression = deriveProgression(generated, []);

    expect(progression.standings).toHaveLength(3);
  });
});

describe("walkovers and disqualifications", () => {
  test("a walkover advances the present side", () => {
    const generated = generateBracket(["p1", "p2"], {
      family: "single_elimination",
    });
    const [finalKey] = deriveProgression(generated, []).readyMatchKeys;

    const progression = deriveProgression(generated, [
      {
        matchKey: finalKey!,
        sides: [
          { participantId: "p1", outcome: "win" },
          { participantId: "p2", outcome: "walkover" },
        ],
      },
    ]);

    expect(progression.completed).toBe(true);
    expect(progression.championId).toBe("p1");
  });

  test("a disqualification advances the opponent", () => {
    const generated = generateBracket(["p1", "p2"], {
      family: "single_elimination",
    });
    const [finalKey] = deriveProgression(generated, []).readyMatchKeys;

    const progression = deriveProgression(generated, [
      {
        matchKey: finalKey!,
        sides: [
          { participantId: "p2", outcome: "disqualification" },
          { participantId: "p1", outcome: "win" },
        ],
      },
    ]);

    expect(progression.completed).toBe(true);
    expect(progression.championId).toBe("p1");
  });
});

describe("draw rejection in elimination formats", () => {
  test("a draw result is rejected outright", () => {
    const generated = generateBracket(["p1", "p2"], {
      family: "single_elimination",
    });
    const [finalKey] = deriveProgression(generated, []).readyMatchKeys;

    expect(() =>
      deriveProgression(generated, [
        {
          matchKey: finalKey!,
          sides: [
            { participantId: "p1", outcome: "draw" },
            { participantId: "p2", outcome: "draw" },
          ],
        },
      ]),
    ).toThrow("draw");
  });
});

describe("result side validation", () => {
  const readyFinal = () => {
    const generated = generateBracket(["p1", "p2"], {
      family: "single_elimination",
    });
    const [finalKey] = deriveProgression(generated, []).readyMatchKeys;
    return { generated, finalKey: finalKey! };
  };

  test("a one-sided record is rejected, not a bare TypeError", () => {
    const { generated, finalKey } = readyFinal();
    const oneSided = {
      matchKey: finalKey,
      sides: [{ participantId: "p1", outcome: "win" }],
    } as unknown as RecordedResult;

    expect(() => deriveProgression(generated, [oneSided])).toThrow("exactly two sides");
  });

  test("a three-sided record is rejected instead of silently truncated", () => {
    const { generated, finalKey } = readyFinal();
    const threeSided = {
      matchKey: finalKey,
      sides: [
        { participantId: "p1", outcome: "win" },
        { participantId: "p2", outcome: "loss" },
        { participantId: "p3", outcome: "loss" },
      ],
    } as unknown as RecordedResult;

    expect(() => deriveProgression(generated, [threeSided])).toThrow("exactly two sides");
  });
});
