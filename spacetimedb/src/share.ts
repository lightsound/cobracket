import { t } from "spacetimedb/server";
import {
  compareById,
  compareBySeed,
  matchRow,
  participantRow,
  sharedTournamentBySlug,
  sortedRows,
} from "./lib";
import {
  BracketSection,
  ResultSide,
  SlotSource,
  spacetimedb,
  TournamentFormat,
  TournamentStatus,
} from "./schema";

const SharedTournamentRow = t.row("SharedTournamentRow", {
  name: t.string(),
  status: TournamentStatus,
  format: TournamentFormat,
  discipline: t.string(),
});

export const sharedTournament = spacetimedb.anonymousView(
  { name: "shared_tournament", public: true },
  { slug: t.string() },
  t.option(SharedTournamentRow),
  (ctx, { slug }) => {
    const found = sharedTournamentBySlug(ctx.db, slug);
    if (found === undefined) {
      return undefined;
    }
    const { tournament } = found;
    return {
      name: tournament.name,
      status: tournament.status,
      format: tournament.format,
      discipline: found.disciplineName,
    };
  },
);

const SharedParticipantRow = t.row("SharedParticipantRow", {
  participantId: t.u64(),
  name: t.string(),
  seed: t.u32(),
});

export const sharedParticipants = spacetimedb.anonymousView(
  { name: "shared_participants", public: true },
  { slug: t.string() },
  t.array(SharedParticipantRow),
  (ctx, { slug }) => {
    const found = sharedTournamentBySlug(ctx.db, slug);
    if (found === undefined) {
      return [];
    }
    return sortedRows(
      ctx.db.participant.tournamentId.filter(found.tournament.id),
      compareBySeed,
    ).map(participantRow);
  },
);

const SharedMatchRow = t.row("SharedMatchRow", {
  key: t.string(),
  bracket: BracketSection,
  round: t.u32(),
  indexInRound: t.u32(),
  slots: t.array(SlotSource),
});

export const sharedMatches = spacetimedb.anonymousView(
  { name: "shared_matches", public: true },
  { slug: t.string() },
  t.array(SharedMatchRow),
  (ctx, { slug }) => {
    const found = sharedTournamentBySlug(ctx.db, slug);
    if (found === undefined) {
      return [];
    }
    return sortedRows(ctx.db.match.tournamentId.filter(found.tournament.id), compareById).map(
      matchRow,
    );
  },
);

const SharedResultRow = t.row("SharedResultRow", {
  matchKey: t.string(),
  seq: t.u64(),
  sides: t.array(ResultSide),
});

export const sharedResults = spacetimedb.anonymousView(
  { name: "shared_results", public: true },
  { slug: t.string() },
  t.array(SharedResultRow),
  (ctx, { slug }) => {
    const found = sharedTournamentBySlug(ctx.db, slug);
    if (found === undefined) {
      return [];
    }
    return sortedRows(ctx.db.result.tournamentId.filter(found.tournament.id), compareById).flatMap(
      (result) => {
        const match = ctx.db.match.id.find(result.matchId);
        if (match === null || match.tournamentId !== found.tournament.id) {
          // Unreachable: results are only written against matches of
          // the same tournament, and the structure is immutable once
          // results exist. Skipped rather than guessed at — this is
          // the anonymous surface, so a row that does not check out
          // against the gated tournament is never served.
          return [];
        }
        return [{ matchKey: match.key, seq: result.id, sides: result.sides }];
      },
    );
  },
);
