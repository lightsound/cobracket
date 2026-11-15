import { SenderError } from "spacetimedb/server";

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
// Disciplines are one global, permanent namespace (not per-tournament data),
// so the per-tournament bounds above cannot contain minting them. Legitimate
// vocabularies (sports and games) number in the hundreds at most, so 1000
// sits an order of magnitude past plausible use, on the scale of
// MAX_RESULTS, while bounding the suggestion surface.
export const MAX_DISCIPLINES = 1000;

// Names are served verbatim on the anonymous share surface, so characters
// that are invisible or reorder rendering enable display spoofing: C0
// controls, DEL and C1 controls, zero-width characters, and bidi embedding,
// override, and isolate controls. Refusing them (rather than silently
// sanitizing) names the problem for the organizer entering the name.
const FORBIDDEN_NAME_CHARACTERS =
  // oxlint-disable-next-line eslint/no-control-regex -- matching control characters is the point of this gate
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/;

export function requireName(raw: string, label: string): string {
  const name = raw.trim();
  if (name === "") {
    throw new SenderError(`${label} must not be empty`);
  }
  if (FORBIDDEN_NAME_CHARACTERS.test(name)) {
    throw new SenderError(`${label} must not contain control or invisible characters`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new SenderError(`${label} must be at most ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

export function requireRosterCapacity(currentSize: number, adding: number): void {
  if (currentSize + adding > MAX_ROSTER_SIZE) {
    throw new SenderError(`A tournament can have at most ${MAX_ROSTER_SIZE} participants`);
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
