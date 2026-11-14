import type {
  FormatOptions,
  ResultSide as EngineSide,
  SlotSource as EngineSlot,
} from "../../format";
import type { MatchRow, ResultRow, TournamentRow } from "./binding";
import type { FormatArg } from "./validators";

// Conversions between the stored (database) shapes and the format
// engine's shapes. The engine is storage-free: participant ids are
// opaque strings there, u64 row ids here; sum types are tagged unions
// on both sides with different spellings (the engine's `kind`, the
// module's `tag`). These functions are the only place the two
// vocabularies meet — the same converters the M1 composition test
// proved against the views, now on the write path.

export type DbSlot = MatchRow["slots"][number];
export type DbSide = ResultRow["sides"][number];
export type StoredFormat = TournamentRow["format"];

export function formatToEngine(format: StoredFormat): FormatOptions {
  return format.tag === "single_elimination"
    ? { family: "single_elimination" }
    : { family: "double_elimination", grandFinalReset: format.value.grandFinalReset };
}

// The stored form of a format argument: grand-final bracket reset
// defaults to on (spec: Format engine).
export function formatToStored(format: FormatArg): StoredFormat {
  return format.tag === "double_elimination"
    ? {
        tag: "double_elimination",
        value: { grandFinalReset: format.value.grandFinalReset ?? true },
      }
    : { tag: "single_elimination" };
}

export function sameFormat(a: StoredFormat, b: StoredFormat): boolean {
  if (a.tag === "single_elimination" || b.tag === "single_elimination") {
    return a.tag === b.tag;
  }
  return a.value.grandFinalReset === b.value.grandFinalReset;
}

export function slotToEngine(slot: DbSlot): EngineSlot {
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

export function slotToDb(slot: EngineSlot): DbSlot {
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

export function sideToEngine(side: DbSide): EngineSide {
  return {
    participantId: String(side.participantId),
    outcome: side.outcome.tag,
    ...(side.score !== undefined && { score: side.score }),
  };
}
