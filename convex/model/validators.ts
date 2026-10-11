import type { Infer } from "convex/values";
import { v } from "convex/values";

// Validators for function args and returns; storage shapes live in schema.ts.

export const statusValidator = v.union(
  v.literal("draft"),
  v.literal("published"),
  v.literal("live"),
  v.literal("completed"),
);

// Args accept grandFinalReset as optional (defaulting to on, per the spec);
// the stored form in schema.ts keeps it required.
export const formatArgsValidator = v.union(
  v.object({ family: v.literal("single_elimination") }),
  v.object({
    family: v.literal("double_elimination"),
    grandFinalReset: v.optional(v.boolean()),
  }),
);

export const formatValidator = v.union(
  v.object({ family: v.literal("single_elimination") }),
  v.object({ family: v.literal("double_elimination"), grandFinalReset: v.boolean() }),
);

const outcomeValidator = v.union(
  v.literal("win"),
  v.literal("loss"),
  v.literal("draw"),
  v.literal("walkover"),
  v.literal("disqualification"),
);

export const resultSideValidator = v.object({
  participantId: v.id("participants"),
  outcome: outcomeValidator,
  score: v.optional(v.number()),
});

export type ResultSide = Infer<typeof resultSideValidator>;

// fallow-ignore-next-line code-duplication -- intentionally mirrors the stored slotSource union (schema.ts) but is a distinct read-side shape: "unknown" replaces winnerOf/loserOf
export const occupantValidator = v.union(
  v.object({ kind: v.literal("participant"), participantId: v.id("participants") }),
  v.object({ kind: v.literal("bye") }),
  v.object({ kind: v.literal("unknown") }),
);

// The shared (public-safe) per-match shape identifies matches by their
// structural key only; document handles stay on the Organizer surface.
const derivedMatchValidator = v.object({
  key: v.string(),
  bracket: v.union(v.literal("winners"), v.literal("losers"), v.literal("grand_final")),
  round: v.number(),
  indexInRound: v.number(),
  state: v.union(
    v.literal("pending"),
    v.literal("ready"),
    v.literal("completed"),
    v.literal("cancelled"),
  ),
  occupants: v.array(occupantValidator),
  winnerId: v.optional(v.id("participants")),
  loserId: v.optional(v.id("participants")),
  // The effective (latest, still-valid) recorded result for this match:
  // outcome plus optional score per side. Absent for matches resolved
  // structurally (byes) or not yet decided.
  sides: v.optional(v.array(resultSideValidator)),
});

// Organizer matches carry the document id — the handle reportResult takes.
const organizerMatchValidator = derivedMatchValidator.extend({ matchId: v.id("matches") });

const progressionFields = {
  // Matches with two known participants and no effective result — the
  // Organizer's "in progress / up next" list (story 15).
  readyMatchKeys: v.array(v.string()),
  completed: v.boolean(),
  championId: v.optional(v.id("participants")),
  standings: v.array(v.object({ participantId: v.id("participants"), placement: v.number() })),
  // Matches whose latest recorded result no longer applies because a
  // correction upstream changed their pairing; they await re-entry.
  voidedMatchKeys: v.array(v.string()),
};

const progressionValidator = v.object({
  matches: v.array(derivedMatchValidator),
  ...progressionFields,
});

const organizerProgressionValidator = v.object({
  matches: v.array(organizerMatchValidator),
  ...progressionFields,
});

const participantValidator = v.object({
  participantId: v.id("participants"),
  name: v.string(),
  seed: v.number(),
});

const tournamentViewFields = {
  name: v.string(),
  status: statusValidator,
  format: formatValidator,
  discipline: v.string(),
  participants: v.array(participantValidator),
};

// The shared read shape. Deliberately free of Organizer-only data —
// organizerId, recordedBy, shareSlug, and tournament/match document handles —
// so getSharedTournament can return it to unauthenticated viewers as-is.
// Participant ids do appear: they are the public row identity, and no public
// function accepts one.
export const tournamentViewValidator = v.object({
  ...tournamentViewFields,
  // Null until the bracket has been generated (and after a roster change
  // invalidates a draft/published bracket).
  bracket: v.union(progressionValidator, v.null()),
});

export const organizerTournamentViewValidator = v.object({
  ...tournamentViewFields,
  bracket: v.union(organizerProgressionValidator, v.null()),
  tournamentId: v.id("tournaments"),
  shareSlug: v.string(),
  seeding: v.union(v.literal("random"), v.literal("manual")),
});

export type ProgressionView = Infer<typeof progressionValidator>;
export type OrganizerProgressionView = Infer<typeof organizerProgressionValidator>;
export type TournamentView = Infer<typeof tournamentViewValidator>;
