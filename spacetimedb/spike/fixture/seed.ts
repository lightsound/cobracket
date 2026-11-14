// fallow-ignore-file coverage-gaps -- executed only inside the spike's assembled module (verify-read-surfaces.ts), never imported by a test; the spike's own verdict is its coverage, and an assembled copy is not an import edge
import { spacetimedb } from "../../src/schema";

// Spike-only fixture reducers (migration slice M1): the wire-level
// spike (verify-read-surfaces.ts) assembles a throwaway module from
// the committed module sources plus this file, publishes it to a
// local standalone, and probes the read surfaces over real
// connections. This file is never part of the shipped module — the
// driver copies it into the assembled module's src/ (rewriting the
// import above to "./schema") and adds it to the entry's exports.
//
// The fixture: the caller is bound as an anonymous organizer owning
// three tournaments — a published 4-player single elimination (one
// result recorded) whose slug the shared surface must open, a draft
// that must stay invisible there, and a published-but-private
// tournament (with participants of its own) that must stay invisible
// too: each hidden one fails exactly one conjunct of the shared
// gate. spikeBind lets a second connection bind itself, so the
// sender-gating probe runs as a bound-but-not-owner organizer
// rather than an unbound identity.

export const spikeSeed = spacetimedb.reducer({}, (ctx) => {
  const discipline = ctx.db.discipline.insert({
    id: 0n,
    name: "Street Fighter 6",
    normalizedName: "street fighter 6",
  });
  const user = ctx.db.appUser.insert({ id: 0n });
  ctx.db.identityUser.insert({
    identity: ctx.sender,
    userId: user.id,
    kind: { tag: "anonymous" },
  });
  const cup = ctx.db.tournament.insert({
    id: 0n,
    name: "Cup",
    userId: user.id,
    disciplineId: discipline.id,
    format: { tag: "single_elimination" },
    drawsAllowed: false,
    status: { tag: "published" },
    visibility: { tag: "unlisted" },
    seeding: undefined,
    shareSlug: "abc123slug",
  });
  const names = ["Ada", "Ben", "Cid", "Dee"];
  const ids = names.map(
    (name, i) => ctx.db.participant.insert({ id: 0n, tournamentId: cup.id, name, seed: i + 1 }).id,
  );
  const first = ctx.db.match.insert({
    id: 0n,
    tournamentId: cup.id,
    key: "W1M1",
    bracket: { tag: "winners" },
    round: 1,
    indexInRound: 0,
    slots: [
      { tag: "participant", value: { participantId: ids[0]! } },
      { tag: "participant", value: { participantId: ids[3]! } },
    ],
  });
  ctx.db.match.insert({
    id: 0n,
    tournamentId: cup.id,
    key: "W1M2",
    bracket: { tag: "winners" },
    round: 1,
    indexInRound: 1,
    slots: [
      { tag: "participant", value: { participantId: ids[1]! } },
      { tag: "participant", value: { participantId: ids[2]! } },
    ],
  });
  ctx.db.match.insert({
    id: 0n,
    tournamentId: cup.id,
    key: "W2M1",
    bracket: { tag: "winners" },
    round: 2,
    indexInRound: 0,
    slots: [
      { tag: "winnerOf", value: { matchKey: "W1M1" } },
      { tag: "winnerOf", value: { matchKey: "W1M2" } },
    ],
  });
  ctx.db.result.insert({
    id: 0n,
    tournamentId: cup.id,
    matchId: first.id,
    sides: [
      { participantId: ids[0]!, outcome: { tag: "win" }, score: undefined },
      { participantId: ids[3]!, outcome: { tag: "loss" }, score: undefined },
    ],
    recordedBy: user.id,
    reportedAt: ctx.timestamp,
  });
  ctx.db.tournament.insert({
    id: 0n,
    name: "Secret Draft",
    userId: user.id,
    disciplineId: discipline.id,
    format: { tag: "single_elimination" },
    drawsAllowed: false,
    status: { tag: "draft" },
    visibility: { tag: "unlisted" },
    seeding: undefined,
    shareSlug: "draftslug999",
  });
  const hidden = ctx.db.tournament.insert({
    id: 0n,
    name: "Hidden Cup",
    userId: user.id,
    disciplineId: discipline.id,
    format: { tag: "single_elimination" },
    drawsAllowed: false,
    status: { tag: "published" },
    visibility: { tag: "private" },
    seeding: undefined,
    shareSlug: "privateslug",
  });
  // Participants of its own, so the shared surface's empty answer
  // for this slug is the gate's doing, not an empty table's.
  ctx.db.participant.insert({ id: 0n, tournamentId: hidden.id, name: "Eve", seed: 1 });
  ctx.db.participant.insert({ id: 0n, tournamentId: hidden.id, name: "Fox", seed: 2 });
});

// Binds the caller as an anonymous organizer (a fresh app_user) if
// they are not bound yet; a no-op for an already-bound caller.
export const spikeBind = spacetimedb.reducer({}, (ctx) => {
  if (ctx.db.identityUser.identity.find(ctx.sender) !== null) {
    return;
  }
  const user = ctx.db.appUser.insert({ id: 0n });
  ctx.db.identityUser.insert({
    identity: ctx.sender,
    userId: user.id,
    kind: { tag: "anonymous" },
  });
});

// A second result (W1M2: Ben beats Cid 2–1) plus a rename of the
// published tournament — the live-update probes watch the shared
// views react to both.
export const spikeMutate = spacetimedb.reducer({}, (ctx) => {
  const cup = ctx.db.tournament.shareSlug.find("abc123slug");
  if (cup === null) {
    throw new Error("fixture tournament missing — run spikeSeed first");
  }
  // oxlint-disable-next-line unicorn/no-useless-spread -- SpacetimeDB index filters return a lazy iterator with no array methods; the spread is what materializes it
  const matches = [...ctx.db.match.tournamentId.filter(cup.id)];
  const second = matches.find((match) => match.key === "W1M2")!;
  // oxlint-disable-next-line unicorn/no-useless-spread -- SpacetimeDB index filters return a lazy iterator with no array methods; the spread is what materializes it
  const parts = [...ctx.db.participant.tournamentId.filter(cup.id)];
  const winner = parts.find((p) => p.seed === 2)!;
  const loser = parts.find((p) => p.seed === 3)!;
  ctx.db.result.insert({
    id: 0n,
    tournamentId: cup.id,
    matchId: second.id,
    sides: [
      { participantId: winner.id, outcome: { tag: "win" }, score: 2 },
      { participantId: loser.id, outcome: { tag: "loss" }, score: 1 },
    ],
    recordedBy: cup.userId,
    reportedAt: ctx.timestamp,
  });
  ctx.db.tournament.id.update({ ...cup, name: "Cup Finals" });
});
