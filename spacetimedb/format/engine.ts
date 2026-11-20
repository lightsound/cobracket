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

// Draws (the drawsAllowed threading): docs/adr/0002-format-scope-five-families-no-custom.md.
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

export function generateBracket(
  participantIds: readonly string[],
  format: FormatOptions,
): BracketStructure {
  return engines[format.family].generate(participantIds, format);
}

export function deriveProgression(
  structure: BracketStructure,
  results: readonly RecordedResult[],
): Progression {
  return evaluate(structure, results, engines[structure.format.family].rules);
}
