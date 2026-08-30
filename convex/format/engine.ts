import { evaluate } from "./evaluate";
import type { FamilyRules } from "./evaluate";
import {
  generateSingleElimination,
  singleEliminationRules,
} from "./singleElimination";
import type {
  BracketStructure,
  FormatFamily,
  FormatOptions,
  Progression,
  RecordedResult,
} from "./types";

interface FamilyEngine {
  generate(
    participantIds: readonly string[],
    options: FormatOptions,
  ): BracketStructure;
  rules: FamilyRules;
}

// One entry per format family (ADR 0002): round robin, Swiss, and
// group-into-playoffs plug in here without touching the existing engines.
const engines: Record<FormatFamily, FamilyEngine> = {
  single_elimination: {
    generate: (participantIds) => generateSingleElimination(participantIds),
    rules: singleEliminationRules,
  },
  double_elimination: {
    generate: () => {
      throw new Error("not implemented");
    },
    rules: singleEliminationRules,
  },
};

// (participants in seeding order + format options) → bracket structure.
// Seeding is an input fixed here; only results move the bracket afterwards.
export function generateBracket(
  participantIds: readonly string[],
  format: FormatOptions,
): BracketStructure {
  return engines[format.family].generate(participantIds, format);
}

// (bracket structure + recorded results) → progression, current matches,
// and standings. Pure and recomputable at any time (ADR 0005).
export function deriveProgression(
  structure: BracketStructure,
  results: readonly RecordedResult[],
): Progression {
  return evaluate(structure, results, engines[structure.format.family].rules);
}
