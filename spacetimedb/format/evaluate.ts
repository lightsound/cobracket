import { FormatEngineError } from "./errors";
import type {
  BracketStructure,
  DerivedMatch,
  MatchState,
  Occupant,
  Progression,
  RecordedResult,
  SlotSource,
  StandingsEntry,
  StructureMatch,
} from "./types";

// Family-specific behavior plugged into the shared evaluator. New families
// (round robin, Swiss, group-into-playoffs) implement this interface plus a
// generator; the evaluator itself is structure-driven and stays unchanged.
export interface FamilyRules {
  allowsDraws: boolean;
  // Stage number at which losing this match eliminates a participant; later
  // stages place higher. Only consulted for matches whose loser exits.
  eliminationStage(match: StructureMatch, structure: BracketStructure): number;
  // True when upstream outcomes make this match structurally unnecessary
  // (e.g. a grand-final reset after the winners-side finalist already won).
  isCancelled(
    match: StructureMatch,
    resolutionOf: (matchKey: string) => MatchResolution | undefined,
  ): boolean;
}

// Internal per-match resolution, richer than the exposed DerivedMatch: byes
// propagate as occupants (a match between two byes "wins" a bye forward).
export interface MatchResolution {
  state: MatchState;
  occupants: [Occupant, Occupant];
  winner: Occupant;
  loser: Occupant;
  resultIndex?: number;
}

const UNKNOWN: Occupant = { kind: "unknown" };
const BYE: Occupant = { kind: "bye" };

const PENDING: MatchResolution = {
  state: "pending",
  occupants: [UNKNOWN, UNKNOWN],
  winner: UNKNOWN,
  loser: UNKNOWN,
};

function validateResult(
  result: RecordedResult,
  index: number,
  matchesByKey: Map<string, StructureMatch>,
  rules: FamilyRules,
): void {
  if (!matchesByKey.has(result.matchKey)) {
    throw new FormatEngineError(
      "unknown_match",
      `result ${index} references unknown match "${result.matchKey}"`,
    );
  }
  if (result.sides.length !== 2) {
    // The 2-tuple type is not enforceable at the DB boundary (the schema
    // stores sides as an array), so guard the arity at runtime too.
    throw new FormatEngineError(
      "invalid_result",
      // oxlint-disable-next-line typescript/restrict-template-expressions -- the 2-tuple type makes this branch's `length` `never`, but the runtime guard is the point
      `result ${index} must have exactly two sides, got ${result.sides.length}`,
    );
  }
  const [a, b] = result.sides;
  if (a.participantId === b.participantId) {
    throw new FormatEngineError(
      "invalid_result",
      `result ${index} lists the same participant on both sides`,
    );
  }
  const outcomes = [a.outcome, b.outcome].sort().join("+");
  if (outcomes === "draw+draw") {
    if (!rules.allowsDraws) {
      throw new FormatEngineError(
        "draw_not_allowed",
        `result ${index} is a draw, which this format does not allow`,
      );
    }
    return;
  }
  const decisive =
    outcomes === "loss+win" || outcomes === "walkover+win" || outcomes === "disqualification+win";
  if (!decisive) {
    throw new FormatEngineError(
      "invalid_result",
      `result ${index} has an invalid outcome combination (${outcomes})`,
    );
  }
}

function resolveWithoutResult(occupants: [Occupant, Occupant]): MatchResolution | undefined {
  const [a, b] = occupants;
  if (a.kind === "unknown" || b.kind === "unknown") {
    return { ...PENDING, occupants };
  }
  if (a.kind === "bye" && b.kind === "bye") {
    // Nobody to play: the bye itself advances.
    return { state: "completed", occupants, winner: BYE, loser: BYE };
  }
  if (a.kind === "bye" || b.kind === "bye") {
    const advancing = a.kind === "bye" ? b : a;
    return { state: "completed", occupants, winner: advancing, loser: BYE };
  }
  return undefined;
}

function applyResult(
  result: RecordedResult,
  resultIndex: number,
  occupants: [Occupant, Occupant],
): MatchResolution | undefined {
  const occupantIds = new Set(
    occupants.map((o) => (o.kind === "participant" ? o.participantId : "")),
  );
  const pairingMatches = result.sides.every((side) => occupantIds.has(side.participantId));
  if (!pairingMatches) {
    // A correction upstream changed the occupants: the record is void and
    // the match awaits a new result.
    return undefined;
  }
  const winnerSide = result.sides.find((side) => side.outcome === "win");
  if (winnerSide === undefined) {
    // validateResult only lets a draw through when the rules allow draws, but
    // how a draw advances through winnerOf/loserOf slots is a design decision
    // owned by the first draw-capable family. Until one lands, fail typed
    // instead of dereferencing a missing winner.
    throw new FormatEngineError(
      "draw_progression_unsupported",
      `result ${resultIndex} is a draw, and draw progression is not implemented under this format's rules`,
    );
  }
  const loserSide = result.sides.find((side) => side.outcome !== "win")!;
  return {
    state: "completed",
    occupants,
    winner: { kind: "participant", participantId: winnerSide.participantId },
    loser: { kind: "participant", participantId: loserSide.participantId },
    resultIndex,
  };
}

// Resolves every match: occupants from slot sources, then the effective
// (latest, pairing-valid) result, a structural bye, or ready/pending.
function resolveMatches(
  structure: BracketStructure,
  matchesByKey: Map<string, StructureMatch>,
  results: readonly RecordedResult[],
  latestResultIndex: Map<string, number>,
  rules: FamilyRules,
): Map<string, MatchResolution> {
  const resolutions = new Map<string, MatchResolution>();
  const resolutionOf = (matchKey: string) => resolutions.get(matchKey);
  // Matches currently being resolved, for cycle detection. Reaching the same
  // upstream match twice through different paths (normal in double
  // elimination) is fine because resolved matches leave this set.
  const resolving = new Set<string>();

  function resolveSlot(slot: SlotSource): Occupant {
    switch (slot.kind) {
      case "participant":
        return { kind: "participant", participantId: slot.participantId };
      case "bye":
        return BYE;
      case "winnerOf":
        return resolveMatch(slot.matchKey).winner;
      case "loserOf":
        return resolveMatch(slot.matchKey).loser;
    }
  }

  function resolveMatch(matchKey: string): MatchResolution {
    const existing = resolutions.get(matchKey);
    if (existing) {
      return existing;
    }
    const match = matchesByKey.get(matchKey);
    if (!match) {
      throw new FormatEngineError("unknown_match", `slot references unknown match "${matchKey}"`);
    }
    if (resolving.has(matchKey)) {
      throw new FormatEngineError(
        "invalid_structure",
        `slot references form a cycle through match "${matchKey}"`,
      );
    }
    resolving.add(matchKey);

    // Resolve upstream matches first so cancellation rules can inspect them.
    for (const slot of match.slots) {
      if (slot.kind === "winnerOf" || slot.kind === "loserOf") {
        resolveMatch(slot.matchKey);
      }
    }

    const resolution = rules.isCancelled(match, resolutionOf)
      ? { ...PENDING, state: "cancelled" as const }
      : resolvePlayableMatch(match);
    resolutions.set(matchKey, resolution);
    resolving.delete(matchKey);
    return resolution;
  }

  function resolvePlayableMatch(match: StructureMatch): MatchResolution {
    const occupants: [Occupant, Occupant] = [
      resolveSlot(match.slots[0]),
      resolveSlot(match.slots[1]),
    ];
    const structural = resolveWithoutResult(occupants);
    if (structural) {
      return structural;
    }
    const candidateIndex = latestResultIndex.get(match.key);
    const applied =
      candidateIndex !== undefined
        ? applyResult(results[candidateIndex]!, candidateIndex, occupants)
        : undefined;
    return applied ?? { ...PENDING, state: "ready", occupants };
  }

  for (const match of structure.matches) {
    resolveMatch(match.key);
  }
  return resolutions;
}

interface ConsumedSlots {
  winnerConsumed: Set<string>;
  loserConsumed: Set<string>;
}

// Which matches' winners/losers feed another (non-cancelled) match.
function collectConsumedSlots(
  structure: BracketStructure,
  resolutions: Map<string, MatchResolution>,
): ConsumedSlots {
  const winnerConsumed = new Set<string>();
  const loserConsumed = new Set<string>();
  for (const match of structure.matches) {
    if (resolutions.get(match.key)!.state === "cancelled") {
      continue;
    }
    for (const slot of match.slots) {
      if (slot.kind === "winnerOf") {
        winnerConsumed.add(slot.matchKey);
      } else if (slot.kind === "loserOf") {
        loserConsumed.add(slot.matchKey);
      }
    }
  }
  return { winnerConsumed, loserConsumed };
}

// Elimination: losing a match whose loser goes nowhere ends the run.
function collectEliminationStages(
  structure: BracketStructure,
  active: readonly StructureMatch[],
  resolutions: Map<string, MatchResolution>,
  loserConsumed: Set<string>,
  rules: FamilyRules,
): Map<string, number> {
  const stages = new Map<string, number>();
  for (const match of active) {
    const resolution = resolutions.get(match.key)!;
    if (
      resolution.state === "completed" &&
      resolution.loser.kind === "participant" &&
      !loserConsumed.has(match.key)
    ) {
      stages.set(resolution.loser.participantId, rules.eliminationStage(match, structure));
    }
  }
  return stages;
}

// Placement: 1 + how many participants outlasted you. Participants still in
// contention (the champion included) outlast every eliminated one and tie
// with each other at the top.
function computeStandings(
  participantIds: ReadonlySet<string>,
  eliminationStages: Map<string, number>,
): StandingsEntry[] {
  const stages = [...participantIds].map((participantId) => ({
    participantId,
    stage: eliminationStages.get(participantId) ?? Infinity,
  }));
  return stages
    .map(({ participantId, stage }) => ({
      participantId,
      placement: 1 + stages.filter((other) => other.stage > stage).length,
    }))
    .sort((a, b) => a.placement - b.placement || a.participantId.localeCompare(b.participantId));
}

function collectParticipantIds(structure: BracketStructure): Set<string> {
  const participantIds = new Set<string>();
  for (const match of structure.matches) {
    for (const slot of match.slots) {
      if (slot.kind === "participant") {
        participantIds.add(slot.participantId);
      }
    }
  }
  return participantIds;
}

function toDerivedMatch(match: StructureMatch, resolution: MatchResolution): DerivedMatch {
  return {
    key: match.key,
    bracket: match.bracket,
    round: match.round,
    indexInRound: match.indexInRound,
    state: resolution.state,
    occupants: resolution.occupants,
    ...(resolution.winner.kind === "participant" && {
      winnerId: resolution.winner.participantId,
    }),
    ...(resolution.loser.kind === "participant" && {
      loserId: resolution.loser.participantId,
    }),
    ...(resolution.resultIndex !== undefined && {
      resultIndex: resolution.resultIndex,
    }),
  };
}

export function evaluate(
  structure: BracketStructure,
  results: readonly RecordedResult[],
  rules: FamilyRules,
): Progression {
  const matchesByKey = new Map(structure.matches.map((match) => [match.key, match]));

  // Latest record per match is the effective candidate; earlier records for
  // the same match are corrections' history and are simply superseded.
  const latestResultIndex = new Map<string, number>();
  results.forEach((result, index) => {
    validateResult(result, index, matchesByKey, rules);
    latestResultIndex.set(result.matchKey, index);
  });

  const resolutions = resolveMatches(structure, matchesByKey, results, latestResultIndex, rules);

  // A latest record that did not end up deciding its match is void: either
  // its pairing became invalid, or its match is structurally resolved (bye)
  // or cancelled. Superseded (corrected-over) records are not void.
  const voidedResultIndices = [...latestResultIndex]
    .filter(([matchKey, index]) => resolutions.get(matchKey)?.resultIndex !== index)
    .map(([, index]) => index)
    .sort((a, b) => a - b);

  const { winnerConsumed, loserConsumed } = collectConsumedSlots(structure, resolutions);
  const active = structure.matches.filter(
    (match) => resolutions.get(match.key)!.state !== "cancelled",
  );

  const eliminationStages = collectEliminationStages(
    structure,
    active,
    resolutions,
    loserConsumed,
    rules,
  );

  const terminal = active.filter((match) => !winnerConsumed.has(match.key));
  const terminalWinner =
    terminal.length === 1 ? resolutions.get(terminal[0]!.key)!.winner : UNKNOWN;
  const championId =
    terminalWinner.kind === "participant" ? terminalWinner.participantId : undefined;
  const completed =
    championId !== undefined &&
    active.every((match) => resolutions.get(match.key)!.state === "completed");

  const matches = structure.matches.map((match) =>
    toDerivedMatch(match, resolutions.get(match.key)!),
  );

  return {
    matches,
    readyMatchKeys: matches.filter((match) => match.state === "ready").map((match) => match.key),
    completed,
    ...(completed && { championId }),
    standings: computeStandings(collectParticipantIds(structure), eliminationStages),
    voidedResultIndices,
  };
}
