import { describe, expect, test } from "vite-plus/test";
import { deriveProgression, generateBracket } from "../format";
import type {
  BracketStructure,
  FormatOptions,
  Progression,
  RecordedResult,
  ResultSide as EngineSide,
  SlotSource as EngineSlot,
} from "../format";
import * as moduleExports from "../src/index";
import { asModule, authFor, identityFor, makeHarness, type Harness } from "./harness";

// The getTournament shape proof (migration slice M1, spike surface
// (b)): ADR 0031 replaces Convex's one assembled query with flat
// per-table views the client composes. This test builds a full
// 16-player double-elimination tournament — the browser gate's
// scenario size — plays it to completion through the tables
// (including a correction that voids downstream records), then shows
// that composing the four Organizer views client-side and running
// the relocated engine over the composed inputs yields exactly the
// read shape a direct engine derivation over the fixture produces:
// same header, same roster, same derived matches (with the
// Organizer's match handles), same voided keys, same champion.

const ORGANIZER = "organizer-a";
const PLAYER_COUNT = 16;

type DbSlot = ReturnType<typeof moduleExports.organizerMatches>[number]["slots"][number];
type DbSide = ReturnType<typeof moduleExports.organizerResults>[number]["sides"][number];
type OrganizerHeader = NonNullable<ReturnType<typeof moduleExports.organizerTournament>>;
type DbFormat = OrganizerHeader["format"];

function slotToEngine(slot: DbSlot): EngineSlot {
  switch (slot.tag) {
    case "participant":
      return { kind: "participant", participantId: String(slot.value.participantId) };
    case "bye":
      return { kind: "bye" };
    case "winnerOf":
      return { kind: "winnerOf", matchKey: slot.value.matchKey };
    case "loserOf":
      return { kind: "loserOf", matchKey: slot.value.matchKey };
  }
}

function slotToDb(slot: EngineSlot): DbSlot {
  switch (slot.kind) {
    case "participant":
      return { tag: "participant", value: { participantId: BigInt(slot.participantId) } };
    case "bye":
      return { tag: "bye" };
    case "winnerOf":
      return { tag: "winnerOf", value: { matchKey: slot.matchKey } };
    case "loserOf":
      return { tag: "loserOf", value: { matchKey: slot.matchKey } };
  }
}

function sideToEngine(side: DbSide): EngineSide {
  return {
    participantId: String(side.participantId),
    outcome: side.outcome.tag,
    ...(side.score !== undefined && { score: side.score }),
  };
}

function outcomeToDb(outcome: EngineSide["outcome"]): DbSide["outcome"] {
  switch (outcome) {
    case "win":
      return { tag: "win" };
    case "loss":
      return { tag: "loss" };
    case "draw":
      return { tag: "draw" };
    case "walkover":
      return { tag: "walkover" };
    case "disqualification":
      return { tag: "disqualification" };
  }
}

function sideToDb(side: EngineSide): DbSide {
  return {
    participantId: BigInt(side.participantId),
    outcome: outcomeToDb(side.outcome),
    // The row type carries score as a present-but-optional value.
    score: side.score,
  };
}

function formatToEngine(format: DbFormat): FormatOptions {
  return format.tag === "single_elimination"
    ? { family: "single_elimination" }
    : { family: "double_elimination", grandFinalReset: format.value.grandFinalReset };
}

interface Header {
  name: string;
  status: string;
  format: FormatOptions;
  discipline: string;
  tournamentId: string;
  shareSlug: string;
  seeding: string;
}

// The assembly convex/model/views.ts performs server-side today
// (buildTournamentView + toProgressionView + withMatchIds), written
// once over engine inputs; the fixture side and the view side both
// feed it, so any transport loss through the tables and views shows
// up as an input difference.
function assemble(
  header: Header,
  participants: { participantId: string; name: string; seed: number }[],
  progression: Progression,
  recorded: readonly RecordedResult[],
  matchIdByKey: ReadonlyMap<string, string>,
) {
  return {
    ...header,
    participants,
    bracket: {
      matches: progression.matches.map((match) => ({
        key: match.key,
        bracket: match.bracket,
        round: match.round,
        indexInRound: match.indexInRound,
        state: match.state,
        occupants: match.occupants,
        ...(match.winnerId !== undefined && { winnerId: match.winnerId }),
        ...(match.loserId !== undefined && { loserId: match.loserId }),
        ...(match.resultIndex !== undefined && {
          sides: recorded[match.resultIndex]!.sides,
        }),
        matchId: matchIdByKey.get(match.key),
      })),
      readyMatchKeys: progression.readyMatchKeys,
      completed: progression.completed,
      ...(progression.championId !== undefined && { championId: progression.championId }),
      standings: progression.standings,
      voidedMatchKeys: progression.voidedResultIndices.map((index) => recorded[index]!.matchKey),
    },
  };
}

describe("getTournament composition over views", () => {
  test("a played-out 16-player double elimination composes identically", () => {
    const harness: Harness = makeHarness();
    const organizerIdentity = identityFor(harness, ORGANIZER);

    const engineIds = Array.from({ length: PLAYER_COUNT }, (_, i) => String(i + 1));
    const format: FormatOptions = { family: "double_elimination", grandFinalReset: true };
    const structure: BracketStructure = generateBracket(engineIds, format);
    expect(structure.matches).toHaveLength(31);

    // Seed the fixture: roster in seed order (auto-increment ids then
    // match the engine's string ids), structure from the engine.
    const seeded = asModule(harness, (ctx) => {
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
      const tournament = ctx.db.tournament.insert({
        id: 0n,
        name: "Championship",
        userId: user.id,
        disciplineId: discipline.id,
        format: { tag: "double_elimination", value: { grandFinalReset: true } },
        drawsAllowed: false,
        status: { tag: "live" },
        visibility: { tag: "unlisted" },
        seeding: undefined,
        shareSlug: "championshipslug",
      });
      const participantIds = engineIds.map(
        (_, i) =>
          ctx.db.participant.insert({
            id: 0n,
            tournamentId: tournament.id,
            name: `Player ${i + 1}`,
            seed: i + 1,
          }).id,
      );
      // The engine's string ids are the seed positions; auto-increment
      // must agree, or every mapping below is meaningless.
      expect(participantIds.map(String)).toEqual(engineIds);
      const matchIdByKey = new Map<string, bigint>();
      for (const match of structure.matches) {
        const row = ctx.db.match.insert({
          id: 0n,
          tournamentId: tournament.id,
          key: match.key,
          bracket: { tag: match.bracket },
          round: match.round,
          indexInRound: match.indexInRound,
          slots: match.slots.map(slotToDb),
        });
        matchIdByKey.set(match.key, row.id);
      }
      return { tournamentId: tournament.id, userId: user.id, matchIdByKey };
    });

    // Play the bracket: always record the first ready match (first
    // occupant wins 2–0). After sixteen records — winners rounds 1–2
    // and losers round 1, so both consumers of the first match's
    // outcome already hold records — correct the first match by
    // flipping its winner: those downstream records must void, on
    // both sides of the comparison.
    const recorded: RecordedResult[] = [];
    const appendResult = (result: RecordedResult) => {
      recorded.push(result);
      asModule(harness, (ctx) => {
        ctx.db.result.insert({
          id: 0n,
          tournamentId: seeded.tournamentId,
          matchId: seeded.matchIdByKey.get(result.matchKey)!,
          sides: result.sides.map(sideToDb),
          recordedBy: seeded.userId,
          reportedAt: ctx.timestamp,
        });
      });
    };
    let corrected = false;
    let voidedAfterCorrection = 0;
    for (let guard = 0; guard < 200; guard++) {
      const progression = deriveProgression(structure, recorded);
      if (progression.completed) {
        break;
      }
      if (!corrected && recorded.length >= 16) {
        const first = recorded[0]!;
        appendResult({
          matchKey: first.matchKey,
          sides: [
            { ...first.sides[1], outcome: "win", score: 2 },
            { ...first.sides[0], outcome: "loss", score: 0 },
          ],
        });
        corrected = true;
        // The correction flips the first match's winner, so the
        // downstream matches already played under the old pairing
        // must stand void until re-entered (the engine reports a
        // match's latest record as void only until then — at
        // completion the void list is empty by construction).
        voidedAfterCorrection = deriveProgression(structure, recorded).voidedResultIndices.length;
        continue;
      }
      const readyKey = progression.readyMatchKeys[0];
      expect(readyKey).toBeDefined();
      const derived = progression.matches.find((match) => match.key === readyKey)!;
      const [a, b] = derived.occupants;
      if (a?.kind !== "participant" || b?.kind !== "participant") {
        throw new Error("a ready match must have two known participants");
      }
      appendResult({
        matchKey: readyKey!,
        sides: [
          { participantId: a.participantId, outcome: "win", score: 2 },
          { participantId: b.participantId, outcome: "loss", score: 0 },
        ],
      });
    }
    const finalProgression = deriveProgression(structure, recorded);
    expect(finalProgression.completed).toBe(true);
    expect(finalProgression.championId).toBeDefined();
    // The fixture must actually exercise the correction path:
    // records were voided by the correction and re-entered after it,
    // so more records exist than matches.
    expect(voidedAfterCorrection).toBeGreaterThan(0);
    expect(recorded.length).toBeGreaterThan(structure.matches.length);

    const expected = assemble(
      {
        name: "Championship",
        status: "live",
        format,
        discipline: "Street Fighter 6",
        tournamentId: String(seeded.tournamentId),
        shareSlug: "championshipslug",
        seeding: "random",
      },
      engineIds.map((id, i) => ({ participantId: id, name: `Player ${i + 1}`, seed: i + 1 })),
      finalProgression,
      recorded,
      new Map([...seeded.matchIdByKey].map(([key, id]) => [key, String(id)])),
    );

    // The view side: fetch the four Organizer views as the owner,
    // translate rows back into engine inputs, derive, assemble.
    const ownerCtx = harness.viewContext(authFor(ORGANIZER));
    const headerRow = moduleExports.organizerTournament(ownerCtx, {
      tournamentId: seeded.tournamentId,
    });
    expect(headerRow).toBeDefined();
    const participantRows = moduleExports.organizerParticipants(ownerCtx, {
      tournamentId: seeded.tournamentId,
    });
    const matchRows = moduleExports.organizerMatches(ownerCtx, {
      tournamentId: seeded.tournamentId,
    });
    const resultRows = moduleExports.organizerResults(ownerCtx, {
      tournamentId: seeded.tournamentId,
    });
    expect(matchRows).toHaveLength(31);
    expect(resultRows.length).toBe(recorded.length);

    const keyByMatchId = new Map(matchRows.map((row) => [row.matchId, row.key]));
    const composedStructure: BracketStructure = {
      format: formatToEngine(headerRow!.format),
      matches: matchRows.map((row) => ({
        key: row.key,
        bracket: row.bracket.tag,
        round: row.round,
        indexInRound: row.indexInRound,
        slots: [slotToEngine(row.slots[0]!), slotToEngine(row.slots[1]!)],
      })),
    };
    const composedRecorded: RecordedResult[] = [...resultRows]
      .sort((a, b) => (a.resultId < b.resultId ? -1 : 1))
      .map((row) => ({
        matchKey: keyByMatchId.get(row.matchId)!,
        sides: [sideToEngine(row.sides[0]!), sideToEngine(row.sides[1]!)],
      }));
    const composedProgression = deriveProgression(composedStructure, composedRecorded);
    const actual = assemble(
      {
        name: headerRow!.name,
        status: headerRow!.status.tag,
        format: formatToEngine(headerRow!.format),
        discipline: headerRow!.discipline,
        tournamentId: String(headerRow!.tournamentId),
        shareSlug: headerRow!.shareSlug,
        seeding: headerRow!.seeding.tag,
      },
      participantRows.map((row) => ({
        participantId: String(row.participantId),
        name: row.name,
        seed: row.seed,
      })),
      composedProgression,
      composedRecorded,
      new Map(matchRows.map((row) => [row.key, String(row.matchId)])),
    );

    expect(actual).toEqual(expected);
    // The composed shape is the full Organizer read shape of
    // convex/model/validators.ts (organizerTournamentViewValidator).
    expect(Object.keys(actual).sort()).toEqual([
      "bracket",
      "discipline",
      "format",
      "name",
      "participants",
      "seeding",
      "shareSlug",
      "status",
      "tournamentId",
    ]);
    expect(Object.keys(actual.bracket).sort()).toEqual([
      "championId",
      "completed",
      "matches",
      "readyMatchKeys",
      "standings",
      "voidedMatchKeys",
    ]);
  });
});
