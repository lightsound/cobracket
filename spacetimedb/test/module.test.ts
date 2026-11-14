import { describe, expect, test } from "vite-plus/test";
import * as moduleExports from "../src/index";
import { as, asModule, authFor, identityFor, makeHarness, type Harness } from "./harness";

// Smoke + gating tests for the module foundation (migration slice
// M1): the harness loads the real module, a reducer transaction
// round-trips through the tables, and the M1 read surfaces answer —
// the shared (slug) surface anonymously, the Organizer surface only
// for the owning sender. The operations themselves land in M2; the
// fixture rows are seeded directly, as the harness allows.
//
// The fixture exercises every gate branch, not just the happy path:
// the shared gate's two conjuncts are isolated (a draft with public
// visibility would be the third case; here a draft-unlisted and a
// published-private tournament each fail exactly one conjunct, and
// both carry participants/matches/results so an empty answer can
// only come from the gate), and the Organizer surface is probed by
// a second organizer who is *bound* — owns a tournament of their
// own — but does not own the fixture tournaments, which is the
// branch the ownership check itself guards.

const ORGANIZER = "organizer-a";
const STRANGER = "stranger";

interface Seeded {
  publishedId: bigint;
  draftId: bigint;
  privateId: bigint;
  strangerTournamentId: bigint;
  matchId: bigint;
}

function seed(harness: Harness): Seeded {
  const organizerIdentity = identityFor(harness, ORGANIZER);
  const strangerIdentity = identityFor(harness, STRANGER);
  return asModule(harness, (ctx) => {
    const discipline = ctx.db.discipline.insert({
      id: 0n,
      name: "Street Fighter 6",
      normalizedName: "street fighter 6",
    });
    const user = ctx.db.appUser.insert({ id: 0n });
    ctx.db.identityUser.insert({
      identity: organizerIdentity,
      userId: user.id,
      kind: { tag: "anonymous" },
    });
    const stranger = ctx.db.appUser.insert({ id: 0n });
    ctx.db.identityUser.insert({
      identity: strangerIdentity,
      userId: stranger.id,
      kind: { tag: "anonymous" },
    });
    const published = ctx.db.tournament.insert({
      id: 0n,
      name: "Cup",
      userId: user.id,
      disciplineId: discipline.id,
      format: { tag: "single_elimination" },
      drawsAllowed: false,
      status: { tag: "published" },
      visibility: { tag: "unlisted" },
      seeding: undefined,
      shareSlug: "pubslug123",
    });
    const draft = ctx.db.tournament.insert({
      id: 0n,
      name: "Secret Draft",
      userId: user.id,
      disciplineId: discipline.id,
      format: { tag: "single_elimination" },
      drawsAllowed: false,
      status: { tag: "draft" },
      visibility: { tag: "unlisted" },
      seeding: undefined,
      shareSlug: "draftslug9",
    });
    const priv = ctx.db.tournament.insert({
      id: 0n,
      name: "Secret Published",
      userId: user.id,
      disciplineId: discipline.id,
      format: { tag: "single_elimination" },
      drawsAllowed: false,
      status: { tag: "published" },
      visibility: { tag: "private" },
      seeding: undefined,
      shareSlug: "privateslug",
    });
    const strangerTournament = ctx.db.tournament.insert({
      id: 0n,
      name: "Stranger Draft",
      userId: stranger.id,
      disciplineId: discipline.id,
      format: { tag: "single_elimination" },
      drawsAllowed: false,
      status: { tag: "draft" },
      visibility: { tag: "unlisted" },
      seeding: undefined,
      shareSlug: "strangerslug",
    });
    // A played match on the published tournament, and one on the
    // private tournament: the private one's rows exist, so only the
    // gate can keep them off the shared surface.
    const seedPlayedMatch = (tournamentId: bigint, key: string) => {
      const ada = ctx.db.participant.insert({
        id: 0n,
        tournamentId,
        name: "Ada",
        seed: 1,
      });
      const ben = ctx.db.participant.insert({
        id: 0n,
        tournamentId,
        name: "Ben",
        seed: 2,
      });
      const match = ctx.db.match.insert({
        id: 0n,
        tournamentId,
        key,
        bracket: { tag: "winners" },
        round: 1,
        indexInRound: 0,
        slots: [
          { tag: "participant", value: { participantId: ada.id } },
          { tag: "participant", value: { participantId: ben.id } },
        ],
      });
      ctx.db.result.insert({
        id: 0n,
        tournamentId,
        matchId: match.id,
        sides: [
          { participantId: ada.id, outcome: { tag: "win" }, score: 2 },
          { participantId: ben.id, outcome: { tag: "loss" }, score: 0 },
        ],
        recordedBy: user.id,
        reportedAt: ctx.timestamp,
      });
      return match;
    };
    const match = seedPlayedMatch(published.id, "W1M1");
    seedPlayedMatch(draft.id, "W1M1");
    seedPlayedMatch(priv.id, "W1M1");
    return {
      publishedId: published.id,
      draftId: draft.id,
      privateId: priv.id,
      strangerTournamentId: strangerTournament.id,
      matchId: match.id,
    };
  });
}

describe("module foundation", () => {
  test("the harness loads the module and a transaction round-trips", () => {
    const harness = makeHarness();
    const seeded = seed(harness);
    const counts = asModule(harness, (ctx) => ({
      // oxlint-disable-next-line unicorn/no-useless-spread -- SpacetimeDB index filters return a lazy iterator with no array methods; the spread is what materializes it
      participants: [...ctx.db.participant.tournamentId.filter(seeded.publishedId)].length,
      // oxlint-disable-next-line unicorn/no-useless-spread -- SpacetimeDB index filters return a lazy iterator with no array methods; the spread is what materializes it
      results: [...ctx.db.result.tournamentId.filter(seeded.publishedId)].length,
    }));
    expect(counts).toEqual({ participants: 2, results: 1 });
    // A reducer-context write from a chosen sender is visible to the
    // read surfaces afterwards.
    as(harness, ORGANIZER, (ctx) => {
      ctx.db.participant.insert({
        id: 0n,
        tournamentId: seeded.publishedId,
        name: "Cid",
        seed: 3,
      });
    });
    const names = moduleExports
      .sharedParticipants(harness.anonymousViewContext(), {
        slug: "pubslug123",
      })
      .map((row) => row.name);
    expect(names).toEqual(["Ada", "Ben", "Cid"]);
  });

  test("the shared surface opens only a published, non-private tournament", () => {
    const harness = makeHarness();
    seed(harness);
    const anon = harness.anonymousViewContext();
    const header = moduleExports.sharedTournament(anon, { slug: "pubslug123" });
    expect(header?.name).toBe("Cup");
    expect(header?.discipline).toBe("Street Fighter 6");
    // Stored enum values read back with an explicit unit payload.
    expect(header?.status).toEqual({ tag: "published", value: {} });
    // A draft's slug, a private tournament's slug, and an unknown
    // slug all resolve to nothing on every shared view — neither
    // confirms which case it was. The draft and private tournaments
    // carry rows (the private one a played match), so the empty
    // answers are the gate's doing, not an empty table's.
    for (const slug of ["draftslug9", "privateslug", "nosuchslug"]) {
      expect(moduleExports.sharedTournament(anon, { slug })).toBeUndefined();
      expect(moduleExports.sharedParticipants(anon, { slug })).toEqual([]);
      expect(moduleExports.sharedMatches(anon, { slug })).toEqual([]);
      expect(moduleExports.sharedResults(anon, { slug })).toEqual([]);
    }
  });

  test("shared rows carry the shared audience's fields only (ADR 0019)", () => {
    const harness = makeHarness();
    seed(harness);
    const anon = harness.anonymousViewContext();
    const matches = moduleExports.sharedMatches(anon, { slug: "pubslug123" });
    expect(matches).toHaveLength(1);
    expect(Object.keys(matches[0]!).sort()).toEqual([
      "bracket",
      "indexInRound",
      "key",
      "round",
      "slots",
    ]);
    const results = moduleExports.sharedResults(anon, { slug: "pubslug123" });
    expect(results).toHaveLength(1);
    // Keyed by structural match key, sequenced by append order — and
    // no recordedBy, no result row id: no Organizer handles.
    expect(Object.keys(results[0]!).sort()).toEqual(["matchKey", "seq", "sides"]);
    expect(results[0]!.matchKey).toBe("W1M1");
    const header = moduleExports.sharedTournament(anon, { slug: "pubslug123" });
    // No tournamentId either: it is the Organizer surface's
    // addressing key, and Convex's shared view withheld it too.
    expect(Object.keys(header!).sort()).toEqual(["discipline", "format", "name", "status"]);
  });

  test("the Organizer surface answers only for the owning sender", () => {
    const harness = makeHarness();
    const seeded = seed(harness);
    const ownerCtx = harness.viewContext(authFor(ORGANIZER));
    const mine = moduleExports.myTournaments(ownerCtx);
    // Newest first, per listMyTournaments' contract on Convex.
    expect(mine.map((row) => row.name)).toEqual(["Secret Published", "Secret Draft", "Cup"]);
    expect(mine.find((row) => row.name === "Cup")?.shareSlug).toBe("pubslug123");

    const header = moduleExports.organizerTournament(ownerCtx, {
      tournamentId: seeded.publishedId,
    });
    expect(header?.name).toBe("Cup");
    expect(header?.shareSlug).toBe("pubslug123");
    // Seeding was never stored: the view states the effective mode.
    expect(header?.seeding).toEqual({ tag: "random" });

    const matches = moduleExports.organizerMatches(ownerCtx, {
      tournamentId: seeded.publishedId,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchId).toBe(seeded.matchId);
    const results = moduleExports.organizerResults(ownerCtx, {
      tournamentId: seeded.publishedId,
    });
    expect(results[0]?.matchId).toBe(seeded.matchId);

    // A different organizer — bound, and owning a tournament of
    // their own — sees exactly their own list, and the empty surface
    // for every tournament they do not own, drafts and the private
    // one included. The owner, in turn, cannot open theirs.
    const strangerCtx = harness.viewContext(authFor(STRANGER));
    expect(moduleExports.myTournaments(strangerCtx).map((row) => row.name)).toEqual([
      "Stranger Draft",
    ]);
    for (const tournamentId of [seeded.publishedId, seeded.draftId, seeded.privateId]) {
      expect(moduleExports.organizerTournament(strangerCtx, { tournamentId })).toBeUndefined();
      expect(moduleExports.organizerParticipants(strangerCtx, { tournamentId })).toEqual([]);
      expect(moduleExports.organizerMatches(strangerCtx, { tournamentId })).toEqual([]);
      expect(moduleExports.organizerResults(strangerCtx, { tournamentId })).toEqual([]);
    }
    expect(
      moduleExports.organizerTournament(ownerCtx, {
        tournamentId: seeded.strangerTournamentId,
      }),
    ).toBeUndefined();
  });
});
