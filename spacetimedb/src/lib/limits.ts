// Write bounds, the successor of convex/model/limits.ts. Anonymous
// binding is zero-friction (ADR 0031), so every write is bounded:
// generous for the spec's 8–64 participant target, tight enough that
// nobody can bloat rows or push generateBracket into transaction
// limits.
// fallow-ignore-next-line code-duplication -- intentionally mirrors the Convex original during the migration window (both backends live until M6 deletes the Convex side; this module copy is the survivor)
const MAX_NAME_LENGTH = 120;
export const MAX_ROSTER_SIZE = 128;
// Double elimination with a grand-final reset is the largest MVP format:
// 2n - 1 matches for n participants.
export const MAX_MATCHES = 2 * MAX_ROSTER_SIZE;
// Results are append-only (ADR 0005), so corrections grow them: room for
// every match to be recorded and then corrected three times.
export const MAX_RESULTS = 4 * MAX_MATCHES;

export function requireName(raw: string, label: string): string {
  const name = raw.trim();
  if (name === "") {
    throw new Error(`${label} must not be empty`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`${label} must be at most ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

export function requireRosterCapacity(currentSize: number, adding: number): void {
  if (currentSize + adding > MAX_ROSTER_SIZE) {
    throw new Error(`A tournament can have at most ${MAX_ROSTER_SIZE} participants`);
  }
}

// Every per-tournament set is bounded by a limit its writes enforce
// (roster, matches, results; see MAX_ROSTER_SIZE). Reads take one row
// past the bound, so a broken invariant fails loudly instead of
// truncating silently. The module form is synchronous over the index
// filter's lazy iterator: it stops one row past the bound rather than
// materializing the whole set first.
export function takeAll<T>(rows: Iterable<T>, bound: number, what: string): T[] {
  const taken: T[] = [];
  for (const row of rows) {
    taken.push(row);
    if (taken.length > bound) {
      throw new Error(`Invariant violated: more than ${bound} ${what} in one tournament`);
    }
  }
  return taken;
}
