import { describe, expect, test } from "vite-plus/test";
// Parity test: layout reconstructs the engine's slot wiring from
// coordinates (the derived view exposes no slots), and this test is
// what keeps the two in lockstep. It reads the engine through its
// public face — the @public re-exports in `spacetimedb/format`'s
// index — so no boundary is crossed and no suppression is needed.
import { generateBracket } from "../../spacetimedb/format";
import type { BracketStructure } from "../../spacetimedb/format";
import { layoutBracket } from "./layout";
import type { LayoutMatch } from "./layout";

function participantIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `p${index + 1}`);
}

function layoutInput(structure: BracketStructure): LayoutMatch[] {
  return structure.matches.map(({ key, bracket, round, indexInRound }) => ({
    key,
    bracket,
    round,
    indexInRound,
  }));
}

// The edge set the engine's slots imply, under the layout's collapse rule:
// a winner + loser pair from the same source match becomes one winner edge.
function edgesFromSlots(structure: BracketStructure): string[] {
  const edges: string[] = [];
  for (const match of structure.matches) {
    const sources = match.slots.flatMap((slot) => {
      if (slot.kind === "winnerOf") return [{ matchKey: slot.matchKey, kind: "winner" }];
      if (slot.kind === "loserOf") return [{ matchKey: slot.matchKey, kind: "loser" }];
      return [];
    });
    const [first, second] = sources;
    if (first !== undefined && second !== undefined && first.matchKey === second.matchKey) {
      edges.push(`${first.matchKey}>${match.key}:winner`);
    } else {
      for (const source of sources) {
        edges.push(`${source.matchKey}>${match.key}:${source.kind}`);
      }
    }
  }
  return edges.sort();
}

function layoutEdges(structure: BracketStructure): string[] {
  return layoutBracket(layoutInput(structure))
    .edges.map((edge) => `${edge.fromKey}>${edge.toKey}:${edge.kind}`)
    .sort();
}

const ROSTER_SIZES = [2, 3, 4, 5, 6, 8, 11, 16];

describe("layout edges match the engine's slot wiring", () => {
  for (const size of ROSTER_SIZES) {
    test(`single elimination, ${size} participants`, () => {
      const structure = generateBracket(participantIds(size), { family: "single_elimination" });
      expect(layoutEdges(structure)).toEqual(edgesFromSlots(structure));
    });

    for (const grandFinalReset of [true, false]) {
      test(`double elimination, ${size} participants, reset ${grandFinalReset}`, () => {
        const structure = generateBracket(participantIds(size), {
          family: "double_elimination",
          grandFinalReset,
        });
        expect(layoutEdges(structure)).toEqual(edgesFromSlots(structure));
      });
    }
  }
});
