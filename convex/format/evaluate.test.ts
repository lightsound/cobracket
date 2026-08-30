import { describe, expect, test } from "vite-plus/test";

// Direct same-package import (precedent: engine.ts): the public API pins
// rules per family and no shipped family allows draws, so the draw paths
// below are only reachable by calling the evaluator with custom rules.
import { evaluate } from "./evaluate";
import type { FamilyRules } from "./evaluate";
import { deriveProgression, FormatEngineError } from "./index";
import type { BracketStructure, RecordedResult, SlotSource, StructureMatch } from "./index";

function match(key: string, slots: [SlotSource, SlotSource], round = 1): StructureMatch {
  return { key, bracket: "winners", round, indexInRound: 0, slots };
}

function structureOf(matches: StructureMatch[]): BracketStructure {
  return { format: { family: "single_elimination" }, matches };
}

function participant(participantId: string): SlotSource {
  return { kind: "participant", participantId };
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

const drawAllowingRules: FamilyRules = {
  allowsDraws: true,
  eliminationStage: () => 0,
  isCancelled: () => false,
};

const draw = (matchKey: string, a: string, b: string): RecordedResult => ({
  matchKey,
  sides: [
    { participantId: a, outcome: "draw" },
    { participantId: b, outcome: "draw" },
  ],
});

const win = (matchKey: string, winner: string, loser: string): RecordedResult => ({
  matchKey,
  sides: [
    { participantId: winner, outcome: "win" },
    { participantId: loser, outcome: "loss" },
  ],
});

describe("draw progression under draw-allowing rules", () => {
  test("an effective draw record throws a typed draw_progression_unsupported error", () => {
    const structure = structureOf([match("m1", [participant("p1"), participant("p2")])]);

    const error = captureError(() =>
      evaluate(structure, [draw("m1", "p1", "p2")], drawAllowingRules),
    );
    expect(error).toBeInstanceOf(FormatEngineError);
    expect((error as FormatEngineError).code).toBe("draw_progression_unsupported");
  });

  test("a draw record voided by an upstream correction stays void instead of throwing", () => {
    const structure = structureOf([
      match("m1", [participant("p1"), participant("p2")]),
      match("m2", [{ kind: "winnerOf", matchKey: "m1" }, participant("p3")], 2),
    ]);
    // The draw was recorded while p1 occupied m2; the correction reruns m1 in
    // p2's favor, invalidating the draw's pairing before it can progress.
    const results = [win("m1", "p1", "p2"), draw("m2", "p1", "p3"), win("m1", "p2", "p1")];

    const progression = evaluate(structure, results, drawAllowingRules);

    expect(progression.voidedResultIndices).toEqual([1]);
    expect(progression.matches.find((m) => m.key === "m2")?.state).toBe("ready");
  });
});

describe("cyclic slot references", () => {
  test("a self-referencing slot throws a typed invalid_structure error", () => {
    const structure = structureOf([
      match("m1", [{ kind: "winnerOf", matchKey: "m1" }, participant("p1")]),
    ]);

    const error = captureError(() => deriveProgression(structure, []));
    expect(error).toBeInstanceOf(FormatEngineError);
    expect((error as FormatEngineError).code).toBe("invalid_structure");
  });

  test("a two-match cycle throws a typed invalid_structure error", () => {
    const structure = structureOf([
      match("m1", [{ kind: "winnerOf", matchKey: "m2" }, participant("p1")]),
      match("m2", [{ kind: "loserOf", matchKey: "m1" }, participant("p2")], 2),
    ]);

    const error = captureError(() => deriveProgression(structure, []));
    expect(error).toBeInstanceOf(FormatEngineError);
    expect((error as FormatEngineError).code).toBe("invalid_structure");
  });

  test("a diamond (two paths to the same upstream match) is not mistaken for a cycle", () => {
    // m3 consumes both the winner and the loser of m1 — the same upstream is
    // reached twice, which is normal in double elimination structures.
    const structure = structureOf([
      match("m1", [participant("p1"), participant("p2")]),
      match(
        "m3",
        [
          { kind: "winnerOf", matchKey: "m1" },
          { kind: "loserOf", matchKey: "m1" },
        ],
        2,
      ),
    ]);

    const progression = deriveProgression(structure, [win("m1", "p1", "p2")]);

    expect(progression.readyMatchKeys).toEqual(["m3"]);
  });
});
