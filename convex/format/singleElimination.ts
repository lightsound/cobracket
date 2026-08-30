import { FormatEngineError } from "./errors";
import type { FamilyRules } from "./evaluate";
import { firstRoundSeatOrder, nextPowerOfTwo } from "./seeding";
import type { BracketStructure, SlotSource, StructureMatch } from "./types";

// Builds the winners-bracket skeleton shared by single and double
// elimination: seeded/bye first round, then winner-fed rounds down to one
// final. Keys are "w{round}m{number}", e.g. "w2m1".
export function buildWinnersBracket(
  participantIds: readonly string[],
): StructureMatch[] {
  if (participantIds.length < 2) {
    throw new FormatEngineError(
      "too_few_participants",
      `a bracket needs at least 2 participants, got ${participantIds.length}`,
    );
  }
  const size = nextPowerOfTwo(participantIds.length);
  const seats = firstRoundSeatOrder(size);
  const rounds = Math.log2(size);

  const matches: StructureMatch[] = [];
  for (let round = 1; round <= rounds; round++) {
    const matchCount = size / 2 ** round;
    for (let index = 0; index < matchCount; index++) {
      const slots: [SlotSource, SlotSource] =
        round === 1
          ? [
              seatSlot(participantIds, seats[index * 2]!),
              seatSlot(participantIds, seats[index * 2 + 1]!),
            ]
          : [
              { kind: "winnerOf", matchKey: `w${round - 1}m${index * 2 + 1}` },
              { kind: "winnerOf", matchKey: `w${round - 1}m${index * 2 + 2}` },
            ];
      matches.push({
        key: `w${round}m${index + 1}`,
        bracket: "winners",
        round,
        indexInRound: index,
        slots,
      });
    }
  }
  return matches;
}

function seatSlot(
  participantIds: readonly string[],
  seed: number,
): SlotSource {
  const participantId = participantIds[seed - 1];
  return participantId === undefined
    ? { kind: "bye" }
    : { kind: "participant", participantId };
}

export function generateSingleElimination(
  participantIds: readonly string[],
): BracketStructure {
  return {
    format: { family: "single_elimination" },
    matches: buildWinnersBracket(participantIds),
  };
}

export const singleEliminationRules: FamilyRules = {
  allowsDraws: false,
  eliminationStage: (match) => match.round,
  isCancelled: () => false,
};
