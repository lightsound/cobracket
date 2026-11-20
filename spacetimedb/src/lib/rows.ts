// Row materialization shared by the two read surfaces (share.ts and
// tournaments.ts). The surfaces carry different row *types* per
// audience (ADR 0019), but the per-table shapes they project from are
// the same tables, so the projection helpers live here once.

export function sortedRows<T>(rows: Iterable<T>, compare: (a: T, b: T) => number): T[] {
  // oxlint-disable-next-line unicorn/no-useless-spread -- SpacetimeDB index filters return a lazy iterator with no array methods; the spread is what materializes it
  return [...rows].sort(compare);
}

export function compareById(a: { id: bigint }, b: { id: bigint }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function compareByIdDesc(a: { id: bigint }, b: { id: bigint }): number {
  return compareById(b, a);
}

export function compareBySeed(a: { seed: number }, b: { seed: number }): number {
  return a.seed - b.seed;
}

export function participantRow(participant: { id: bigint; name: string; seed: number }) {
  return {
    participantId: participant.id,
    name: participant.name,
    seed: participant.seed,
  };
}

export function matchRow<B, S>(match: {
  key: string;
  bracket: B;
  round: number;
  indexInRound: number;
  slots: S[];
}) {
  return {
    key: match.key,
    bracket: match.bracket,
    round: match.round,
    indexInRound: match.indexInRound,
    slots: match.slots,
  };
}
