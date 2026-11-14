import { t } from "spacetimedb/server";
import {
  compareById,
  compareByIdDesc,
  compareBySeed,
  matchRow,
  organizerIdFor,
  ownedTournament,
  participantRow,
  sortedRows,
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

// The Organizer read surface (ADR 0031): sender-gated views, the
// successor of convex/tournaments.ts's listMyTournaments and
// getTournament. Every view resolves the caller through the binding
// table first; an unbound identity sees nothing, and the
// per-tournament views additionally require ownership
// (ownedTournament) — routes addressed by id are not capabilities
// (ADR 0019).
//
// The row types are the Organizer audience's own (ADR 0019): unlike
// the shared surface they carry the handles the Organizer's reducers
// take — match row ids on matches and results — plus the header's
// shareSlug and seeding. What getTournament assembles server-side on
// Convex (one nested view) is composed by the client here from these
// flat per-table views plus the format engine (ADR 0005).

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
          // Unreachable while disciplines are never deleted; a row
          // without its discipline name is not a listable tournament.
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
      // Absent means "random" (schema.ts) — the read surface states
      // the effective mode, as getTournament does today.
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
    // Append order is the engine's input order (latest record per
    // match wins); resultId is the append sequence.
    return sortedRows(ctx.db.result.tournamentId.filter(found.tournament.id), compareById).map(
      (result) => ({
        matchId: result.matchId,
        resultId: result.id,
        sides: result.sides,
      }),
    );
  },
);
