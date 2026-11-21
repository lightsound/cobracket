import { t } from "spacetimedb/server";
import {
  MAX_MATCHES,
  MAX_RESULTS,
  MAX_ROSTER_SIZE,
  compareById,
  compareByIdDesc,
  compareBySeed,
  formatArg,
  formatToStored,
  getOrCreateDiscipline,
  invalidateBracket,
  matchRow,
  organizerIdFor,
  ownedTournament,
  participantRow,
  requireBoundUser,
  requireEvent,
  requireName,
  requireOwnedTournament,
  mintShareSlug,
  sameFormat,
  sortedRows,
  takeAll,
} from "./lib";
import {
  BracketSection,
  ResultSide,
  SeedingMode,
  SlotSource,
  spacetimedb,
  TournamentFormat,
  TournamentStatus,
} from "./schema";

const MyTournamentRow = t.row("MyTournamentRow", {
  tournamentId: t.u64().primaryKey(),
  name: t.string(),
  status: TournamentStatus,
  format: TournamentFormat,
  discipline: t.string(),
  shareSlug: t.string(),
});

// The Organizer's own tournaments, drafts included, newest first,
// capped at 100 — the contract of Convex's listMyTournaments
// (.order("desc").take(100)): callers must not assume the list is
// complete. No argument: the sender is the only key.
export const myTournaments = spacetimedb.view(
  { name: "my_tournaments", public: true },
  t.array(MyTournamentRow),
  (ctx) => {
    const userId = organizerIdFor(ctx.db, ctx.sender);
    if (userId === undefined) {
      return [];
    }
    return sortedRows(ctx.db.tournament.userId.filter(userId), compareByIdDesc)
      .slice(0, 100)
      .flatMap((tournament) => {
        const discipline = ctx.db.discipline.id.find(tournament.disciplineId);
        if (discipline === null) {
          return [];
        }
        return [
          {
            tournamentId: tournament.id,
            name: tournament.name,
            status: tournament.status,
            format: tournament.format,
            discipline: discipline.name,
            shareSlug: tournament.shareSlug,
          },
        ];
      });
  },
);

const OrganizerTournamentRow = t.row("OrganizerTournamentRow", {
  tournamentId: t.u64(),
  name: t.string(),
  status: TournamentStatus,
  format: TournamentFormat,
  discipline: t.string(),
  shareSlug: t.string(),
  seeding: SeedingMode,
});

export const organizerTournament = spacetimedb.view(
  { name: "organizer_tournament", public: true },
  { tournamentId: t.u64() },
  t.option(OrganizerTournamentRow),
  (ctx, { tournamentId }) => {
    const found = ownedTournament(ctx.db, ctx.sender, tournamentId);
    if (found === undefined) {
      return undefined;
    }
    const { tournament } = found;
    return {
      tournamentId: tournament.id,
      name: tournament.name,
      status: tournament.status,
      format: tournament.format,
      discipline: found.disciplineName,
      shareSlug: tournament.shareSlug,
      seeding: tournament.seeding ?? { tag: "random" },
    };
  },
);

const OrganizerParticipantRow = t.row("OrganizerParticipantRow", {
  participantId: t.u64(),
  name: t.string(),
  seed: t.u32(),
});

export const organizerParticipants = spacetimedb.view(
  { name: "organizer_participants", public: true },
  { tournamentId: t.u64() },
  t.array(OrganizerParticipantRow),
  (ctx, { tournamentId }) => {
    const found = ownedTournament(ctx.db, ctx.sender, tournamentId);
    if (found === undefined) {
      return [];
    }
    return sortedRows(
      ctx.db.participant.tournamentId.filter(found.tournament.id),
      compareBySeed,
    ).map(participantRow);
  },
);

const OrganizerMatchRow = t.row("OrganizerMatchRow", {
  matchId: t.u64(),
  key: t.string(),
  bracket: BracketSection,
  round: t.u32(),
  indexInRound: t.u32(),
  slots: t.array(SlotSource),
});

export const organizerMatches = spacetimedb.view(
  { name: "organizer_matches", public: true },
  { tournamentId: t.u64() },
  t.array(OrganizerMatchRow),
  (ctx, { tournamentId }) => {
    const found = ownedTournament(ctx.db, ctx.sender, tournamentId);
    if (found === undefined) {
      return [];
    }
    return sortedRows(ctx.db.match.tournamentId.filter(found.tournament.id), compareById).map(
      (match) => ({ matchId: match.id, ...matchRow(match) }),
    );
  },
);

const OrganizerResultRow = t.row("OrganizerResultRow", {
  matchId: t.u64(),
  resultId: t.u64(),
  sides: t.array(ResultSide),
});

export const organizerResults = spacetimedb.view(
  { name: "organizer_results", public: true },
  { tournamentId: t.u64() },
  t.array(OrganizerResultRow),
  (ctx, { tournamentId }) => {
    const found = ownedTournament(ctx.db, ctx.sender, tournamentId);
    if (found === undefined) {
      return [];
    }
    return sortedRows(ctx.db.result.tournamentId.filter(found.tournament.id), compareById).map(
      (result) => ({
        matchId: result.matchId,
        resultId: result.id,
        sides: result.sides,
      }),
    );
  },
);

const OrganizerScoreChangeRow = t.row("OrganizerScoreChangeRow", {
  changeId: t.u64(),
  matchId: t.u64(),
  changedBy: t.u64(),
  changedAt: t.timestamp(),
  previousSides: t.array(ResultSide),
  newSides: t.array(ResultSide),
});

export const organizerScoreChanges = spacetimedb.view(
  { name: "organizer_score_changes", public: true },
  { tournamentId: t.u64() },
  t.array(OrganizerScoreChangeRow),
  (ctx, { tournamentId }) => {
    const found = ownedTournament(ctx.db, ctx.sender, tournamentId);
    if (found === undefined) {
      return [];
    }
    return sortedRows(ctx.db.scoreChange.tournamentId.filter(found.tournament.id), compareById).map(
      (change) => ({
        changeId: change.id,
        matchId: change.matchId,
        changedBy: change.changedBy,
        changedAt: change.changedAt,
        previousSides: change.previousSides,
        newSides: change.newSides,
      }),
    );
  },
);

export const createTournament = spacetimedb.reducer(
  { name: t.string(), discipline: t.string(), format: formatArg },
  (ctx, args) => {
    const userId = requireBoundUser(ctx.db, ctx.sender);
    const name = requireName(args.name, "Tournament name");
    const disciplineId = getOrCreateDiscipline(ctx.db, args.discipline);
    const format = formatToStored(args.format);
    const shareSlug = mintShareSlug(ctx.db, userId);
    ctx.db.tournament.insert({
      id: 0n,
      name,
      userId,
      disciplineId,
      format,
      drawsAllowed: false,
      status: { tag: "draft" },
      visibility: { tag: "unlisted" },
      seeding: undefined,
      shareSlug,
    });
  },
);

// Partial update: every field is optional and independently validated.
// Name and Discipline are labels, so they stay editable in every status
// (a typo on the Share Link is worth fixing after completion too). The
// Format decides the bracket structure, so changing it is a pre-live
// operation that drops the generated bracket, exactly like a roster
// change.
export const updateTournament = spacetimedb.reducer(
  {
    tournamentId: t.u64(),
    name: t.string().optional(),
    discipline: t.string().optional(),
    format: formatArg.optional(),
  },
  (ctx, args) => {
    const tournament = requireOwnedTournament(ctx.db, ctx.sender, args.tournamentId);
    const updated = { ...tournament };
    let changed = false;
    if (args.name !== undefined) {
      updated.name = requireName(args.name, "Tournament name");
      changed = true;
    }
    if (args.discipline !== undefined) {
      updated.disciplineId = getOrCreateDiscipline(ctx.db, args.discipline);
      changed = true;
    }
    if (args.format !== undefined) {
      const format = formatToStored(args.format);
      // Re-submitting the current format is a no-op in every status, so a
      // settings form can always send the whole record.
      if (!sameFormat(format, tournament.format)) {
        requireEvent(tournament, { type: "changeFormat" }, "change the format");
        updated.format = format;
        invalidateBracket(ctx.db, tournament.id);
        changed = true;
      }
    }
    if (changed) {
      ctx.db.tournament.id.update(updated);
    }
  },
);

export const deleteTournament = spacetimedb.reducer({ tournamentId: t.u64() }, (ctx, args) => {
  const tournament = requireOwnedTournament(ctx.db, ctx.sender, args.tournamentId);
  const results = takeAll(ctx.db.result.tournamentId.filter(tournament.id), MAX_RESULTS, "results");
  for (const doc of results) {
    ctx.db.result.id.delete(doc.id);
  }
  const scoreChanges = takeAll(
    ctx.db.scoreChange.tournamentId.filter(tournament.id),
    MAX_RESULTS,
    "score changes",
  );
  for (const doc of scoreChanges) {
    ctx.db.scoreChange.id.delete(doc.id);
  }
  const matches = takeAll(ctx.db.match.tournamentId.filter(tournament.id), MAX_MATCHES, "matches");
  for (const doc of matches) {
    ctx.db.match.id.delete(doc.id);
  }
  const participants = takeAll(
    ctx.db.participant.tournamentId.filter(tournament.id),
    MAX_ROSTER_SIZE,
    "participants",
  );
  for (const doc of participants) {
    ctx.db.participant.id.delete(doc.id);
  }
  ctx.db.tournament.id.delete(tournament.id);
});
