import type { FamilyRules, MatchResolution } from "./evaluate";
import { nextPowerOfTwo } from "./seeding";
import { buildWinnersBracket } from "./singleElimination";
import type {
  BracketStructure,
  SlotSource,
  StructureMatch,
} from "./types";

export const GRAND_FINAL_KEY = "gf";
export const GRAND_FINAL_RESET_KEY = "gfr";

// Losers bracket for a winners bracket of `size` seats (size >= 4):
// 2 * (log2(size) - 1) rounds. Odd rounds pair losers-bracket survivors;
// even rounds are drop-in rounds where losers of winners round j+1 enter.
// Drop-in order alternates between reversed and straight so a participant
// does not immediately rematch the opponent who just beat them.
function buildLosersBracket(size: number): StructureMatch[] {
  const winnersRounds = Math.log2(size);
  const matches: StructureMatch[] = [];

  for (let j = 1; j <= winnersRounds - 1; j++) {
    const matchCount = size / 2 ** (j + 1);

    if (j === 1) {
      // Losers round 1: pair up the losers of winners round 1.
      for (let index = 0; index < matchCount; index++) {
        matches.push(
          losersMatch(1, index, [
            { kind: "loserOf", matchKey: `w1m${index * 2 + 1}` },
            { kind: "loserOf", matchKey: `w1m${index * 2 + 2}` },
          ]),
        );
      }
    } else {
      // Odd losers round 2j - 1: survivors of the previous drop-in round.
      for (let index = 0; index < matchCount; index++) {
        matches.push(
          losersMatch(2 * j - 1, index, [
            { kind: "winnerOf", matchKey: `l${2 * j - 2}m${index * 2 + 1}` },
            { kind: "winnerOf", matchKey: `l${2 * j - 2}m${index * 2 + 2}` },
          ]),
        );
      }
    }

    // Even losers round 2j: losers of winners round j + 1 drop in.
    const reversed = j % 2 === 1;
    for (let index = 0; index < matchCount; index++) {
      const dropNumber = reversed ? matchCount - index : index + 1;
      matches.push(
        losersMatch(2 * j, index, [
          { kind: "loserOf", matchKey: `w${j + 1}m${dropNumber}` },
          { kind: "winnerOf", matchKey: `l${2 * j - 1}m${index + 1}` },
        ]),
      );
    }
  }
  return matches;
}

function losersMatch(
  round: number,
  index: number,
  slots: [SlotSource, SlotSource],
): StructureMatch {
  return {
    key: `l${round}m${index + 1}`,
    bracket: "losers",
    round,
    indexInRound: index,
    slots,
  };
}

export function generateDoubleElimination(
  participantIds: readonly string[],
  grandFinalReset: boolean,
): BracketStructure {
  const winners = buildWinnersBracket(participantIds);
  const size = nextPowerOfTwo(participantIds.length);
  const winnersRounds = Math.log2(size);
  const losers = size >= 4 ? buildLosersBracket(size) : [];

  // With two participants there is no losers bracket: the loser of the only
  // winners match goes straight to the grand final for their second chance.
  const losersFinalist: SlotSource =
    losers.length > 0
      ? { kind: "winnerOf", matchKey: losers[losers.length - 1]!.key }
      : { kind: "loserOf", matchKey: `w1m1` };

  const grandFinal: StructureMatch = {
    key: GRAND_FINAL_KEY,
    bracket: "grand_final",
    round: 1,
    indexInRound: 0,
    slots: [
      { kind: "winnerOf", matchKey: `w${winnersRounds}m1` },
      losersFinalist,
    ],
  };

  const matches = [...winners, ...losers, grandFinal];
  if (grandFinalReset) {
    // Played only if the losers-side finalist wins the grand final (both
    // then stand at one loss); otherwise cancelled by the family rules.
    matches.push({
      key: GRAND_FINAL_RESET_KEY,
      bracket: "grand_final",
      round: 2,
      indexInRound: 0,
      slots: [
        { kind: "winnerOf", matchKey: GRAND_FINAL_KEY },
        { kind: "loserOf", matchKey: GRAND_FINAL_KEY },
      ],
    });
  }

  return {
    format: { family: "double_elimination", grandFinalReset },
    matches,
  };
}

function isResetCancelled(
  resolutionOf: (matchKey: string) => MatchResolution | undefined,
): boolean {
  const grandFinal = resolutionOf(GRAND_FINAL_KEY);
  if (grandFinal?.state !== "completed") {
    return false;
  }
  // Slot 0 of the grand final is the winners-side finalist: if they won,
  // the losers-side finalist has their second loss and no reset is needed.
  const winnersSide = grandFinal.occupants[0];
  return (
    grandFinal.winner.kind === "participant" &&
    winnersSide.kind === "participant" &&
    grandFinal.winner.participantId === winnersSide.participantId
  );
}

export const doubleEliminationRules: FamilyRules = {
  allowsDraws: false,
  eliminationStage: (match, structure) => {
    if (match.bracket === "losers") {
      return match.round;
    }
    // Winners-bracket losers always drop somewhere, so only grand-final
    // matches remain: they eliminate above every losers round.
    const maxLosersRound = structure.matches.reduce(
      (max, m) => (m.bracket === "losers" ? Math.max(max, m.round) : max),
      0,
    );
    return maxLosersRound + match.round;
  },
  isCancelled: (match, resolutionOf) =>
    match.key === GRAND_FINAL_RESET_KEY && isResetCancelled(resolutionOf),
};
