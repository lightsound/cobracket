import type { Identity } from "spacetimedb";
import type { Random } from "spacetimedb/server";
import { t } from "spacetimedb/server";
import type { WritableDb } from "./lib";
import {
  MAX_MATCHES,
  MAX_RESULTS,
  MAX_ROSTER_SIZE,
  PRE_LIVE,
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
  requireName,
  requireOwnedTournament,
  requireStatus,
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

// Tournament creation, settings, deletion, and the Organizer read
// surface (ADR 0031) — the successor of convex/tournaments.ts. Every
// view resolves the caller through the binding table first; an
// unbound identity sees nothing, and the per-tournament views
// additionally require ownership (ownedTournament) — routes addressed
// by id are not capabilities (ADR 0019). The reducers below resolve
// identity through requireBoundUser and ownership through the guards,
// in that order.
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

// ---------------------------------------------------------------------------
// Writes (M2): tournament creation, settings, deletion — the successor
// of convex/tournaments.ts's mutations. Reducers return nothing; the
// client re-reads through the views above (createTournament's Convex
// return of { tournamentId, shareSlug } is the newest row of
// my_tournaments).
// ---------------------------------------------------------------------------

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 12;

// The Share Link identifier: an unlisted tournament's URL is its only
// guard, so the slug is minted from randomness (~62 bits) instead of
// reusing the row id, whose format is an implementation detail and
// not designed to be a capability. Convex drew the bytes from
// crypto.getRandomValues; the module has no CSPRNG — ctx.random is
// seeded from the transaction timestamp alone, which anyone can
// guess. XOR-ing the stream with the sender's Identity bytes removes
// that cross-organizer predictability (the Identity is server-minted,
// and XOR with a fixed value keeps a uniform stream uniform) — with
// a stated limit: the mask is fixed per organizer, so one organizer's
// slugs are correlated given known creation timestamps (an observed
// slug plus its timestamp constrains each mask byte to a handful of
// values), where Convex's independent draws were not. Accepted here:
// a slug is a bearer capability only in the unlisted sense —
// publication is what exposes it, and private visibility is enforced
// by the share views' gate, not by slug entropy. The probe-then-
// insert retry loop below disambiguates the residual collisions
// (same sender, same timestamp) by advancing the stream.
function randomSlug(ctx: { random: Random; sender: Identity }): string {
  const bytes = ctx.random.fill(new Uint8Array(SLUG_LENGTH));
  const identity = ctx.sender.toUint8Array();
  return [...bytes]
    .map(
      (byte, index) =>
        SLUG_ALPHABET[(byte ^ identity[index % identity.length]!) % SLUG_ALPHABET.length],
    )
    .join("");
}

function mintShareSlug(ctx: { db: WritableDb; random: Random; sender: Identity }): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = randomSlug(ctx);
    if (ctx.db.tournament.shareSlug.find(slug) === null) {
      return slug;
    }
  }
  throw new Error("could not allocate a share slug");
}

export const createTournament = spacetimedb.reducer(
  { name: t.string(), discipline: t.string(), format: formatArg },
  (ctx, args) => {
    const userId = requireBoundUser(ctx.db, ctx.sender);
    const name = requireName(args.name, "Tournament name");
    const disciplineId = getOrCreateDiscipline(ctx.db, args.discipline);
    const format = formatToStored(args.format);
    const shareSlug = mintShareSlug(ctx);
    ctx.db.tournament.insert({
      id: 0n,
      name,
      userId,
      disciplineId,
      format,
      // Elimination requires a decisive outcome; the field ships for later
      // draw-capable families.
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
        requireStatus(tournament, PRE_LIVE, "change the format");
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

// Deletion is physical and whole (ADR 0011): the tournament and
// everything that hangs off it — roster, bracket, results — go
// together, in every status. Results are never deleted on their own
// (ADR 0005: corrections are the only way to change them); removing
// the tournament they belong to is a different act. The Share Link
// reads as not found from then on. Bounded by one tournament's size,
// like every other per-tournament write.
export const deleteTournament = spacetimedb.reducer({ tournamentId: t.u64() }, (ctx, args) => {
  const tournament = requireOwnedTournament(ctx.db, ctx.sender, args.tournamentId);
  const results = takeAll(ctx.db.result.tournamentId.filter(tournament.id), MAX_RESULTS, "results");
  for (const doc of results) {
    ctx.db.result.id.delete(doc.id);
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
