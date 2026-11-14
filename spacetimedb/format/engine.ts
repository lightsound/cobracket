import { doubleEliminationRules, generateDoubleElimination } from "./doubleElimination";
import { evaluate } from "./evaluate";
import type { FamilyRules } from "./evaluate";
import { generateSingleElimination, singleEliminationRules } from "./singleElimination";
import type {
  BracketStructure,
  FormatFamily,
  FormatOptions,
  Progression,
  RecordedResult,
} from "./types";

interface FamilyEngine {
  generate(participantIds: readonly string[], options: FormatOptions): BracketStructure;
  rules: FamilyRules;
}

// One entry per format family (ADR 0002): round robin, Swiss, and
// group-into-playoffs plug in here without touching the existing engines.
// Note for the round-robin entry: the per-tournament drawsAllowed config
// (convex/schema.ts) has no path into FamilyRules yet — thread it through
// FormatOptions when the first draw-capable family lands; elimination
// families reject draws unconditionally.
const engines: Record<FormatFamily, FamilyEngine> = {
  single_elimination: {
    generate: (participantIds) => generateSingleElimination(participantIds),
    rules: singleEliminationRules,
  },
  double_elimination: {
    generate: (participantIds, options) =>
      generateDoubleElimination(
        participantIds,
        options.family === "double_elimination" && options.grandFinalReset,
      ),
    rules: doubleEliminationRules,
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
