import { ConvexError } from "convex/values";

// Anonymous sign-in is zero-friction (ADR 0003), so every write is bounded:
// generous for the spec's 8–64 participant target, tight enough that nobody
// can bloat documents or push generateBracket into transaction limits.
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
    throw new ConvexError(`${label} must not be empty`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new ConvexError(`${label} must be at most ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

export function requireRosterCapacity(currentSize: number, adding: number): void {
  if (currentSize + adding > MAX_ROSTER_SIZE) {
    throw new ConvexError(`A tournament can have at most ${MAX_ROSTER_SIZE} participants`);
  }
}

// Every per-tournament set is bounded by a limit its writes enforce (roster,
// matches, results; see MAX_ROSTER_SIZE). Reads take one row past the bound,
// so a broken invariant fails loudly instead of truncating silently.
export async function takeAll<T>(
  query: { take(n: number): Promise<T[]> },
  bound: number,
  what: string,
): Promise<T[]> {
  const rows = await query.take(bound + 1);
  if (rows.length > bound) {
    throw new Error(`Invariant violated: more than ${bound} ${what} in one tournament`);
  }
  return rows;
}
