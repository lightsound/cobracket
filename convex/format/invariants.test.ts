import { describe, expect, test } from "bun:test";

import { deriveProgression, generateBracket } from "./index";
import type {
  FormatOptions,
  Progression,
  RecordedResult,
} from "./index";

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `p${i + 1}`);
}

// Plays every ready match until the tournament completes, picking the winner
// by preference order (lower participant number wins unless flipped).
function playToCompletion(
  participantIds: string[],
  format: FormatOptions,
  pickWinner: (a: string, b: string) => string,
): { progression: Progression; playedMatches: number } {
  const structure = generateBracket(participantIds, format);
  const results: RecordedResult[] = [];
  let playedMatches = 0;

  for (let guard = 0; guard < 1000; guard++) {
    const progression = deriveProgression(structure, results);
    const [nextKey] = progression.readyMatchKeys;
    if (nextKey === undefined) {
      return { progression, playedMatches };
    }
    const match = progression.matches.find((m) => m.key === nextKey)!;
    const sides = match.occupants.map((occupant) => {
      if (occupant.kind !== "participant") {
        throw new Error("ready match with a non-participant occupant");
      }
      return occupant.participantId;
    });
    const winner = pickWinner(sides[0]!, sides[1]!);
    const loser = sides.find((id) => id !== winner)!;
    results.push({
      matchKey: nextKey,
      sides: [
        { participantId: winner, outcome: "win" },
        { participantId: loser, outcome: "loss" },
      ],
    });
    playedMatches++;
  }
  throw new Error("tournament did not complete within 1000 matches");
}

const lowerNumberWins = (a: string, b: string) =>
  Number(a.slice(1)) < Number(b.slice(1)) ? a : b;
const higherNumberWins = (a: string, b: string) =>
  Number(a.slice(1)) > Number(b.slice(1)) ? a : b;

describe("single elimination invariants for any roster size", () => {
  for (let count = 2; count <= 33; count++) {
    test(`${count} participants: completes after exactly ${count - 1} played matches`, () => {
      const { progression, playedMatches } = playToCompletion(
        ids(count),
        { family: "single_elimination" },
        lowerNumberWins,
      );

      expect(playedMatches).toBe(count - 1);
      expect(progression.completed).toBe(true);
      expect(progression.championId).toBe("p1");
      expect(progression.standings).toHaveLength(count);
      expect(
        progression.standings.find((entry) => entry.participantId === "p1")
          ?.placement,
      ).toBe(1);
      // Placements start at 1 and never skip past the roster size.
      for (const entry of progression.standings) {
        expect(entry.placement).toBeGreaterThanOrEqual(1);
        expect(entry.placement).toBeLessThanOrEqual(count);
      }
    });
  }

  test("an upset run still produces a champion and full standings", () => {
    const { progression } = playToCompletion(
      ids(13),
      { family: "single_elimination" },
      higherNumberWins,
    );

    expect(progression.completed).toBe(true);
    expect(progression.standings).toHaveLength(13);
    expect(
      progression.standings.filter((entry) => entry.placement === 1),
    ).toHaveLength(1);
  });
});

describe("double elimination invariants for any roster size", () => {
  for (let count = 2; count <= 33; count++) {
    test(`${count} participants: dominant top seed wins after 2n-2 matches`, () => {
      const { progression, playedMatches } = playToCompletion(
        ids(count),
        { family: "double_elimination", grandFinalReset: true },
        lowerNumberWins,
      );

      // p1 never loses, so the reset never triggers.
      expect(playedMatches).toBe(2 * count - 2);
      expect(progression.completed).toBe(true);
      expect(progression.championId).toBe("p1");
      expect(progression.standings).toHaveLength(count);
      expect(progression.standings[0]).toEqual({
        participantId: "p1",
        placement: 1,
      });
      // Exactly one runner-up (the grand-final loser).
      expect(
        progression.standings.filter((entry) => entry.placement === 2),
      ).toHaveLength(1);
    });
  }

  for (let count = 2; count <= 33; count++) {
    test(`${count} participants: scrambled outcomes still complete in 2n-2 or 2n-1 matches`, () => {
      // Deterministic but irregular winner picking, seeded by roster size.
      let state = count * 2654435761;
      const scrambled = (a: string, b: string) => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state % 2 === 0 ? a : b;
      };

      const { progression, playedMatches } = playToCompletion(
        ids(count),
        { family: "double_elimination", grandFinalReset: true },
        scrambled,
      );

      expect(progression.completed).toBe(true);
      expect(progression.championId).toBeDefined();
      expect([2 * count - 2, 2 * count - 1]).toContain(playedMatches);
      expect(progression.standings).toHaveLength(count);
      expect(
        progression.standings.filter((entry) => entry.placement === 1),
      ).toHaveLength(1);
    });
  }
});
