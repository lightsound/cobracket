import { SenderError } from "spacetimedb/server";
import type { WritableDb } from "./binding";
import { MAX_DISCIPLINES, requireName } from "./limits";

export function normalizeDisciplineName(raw: string): { name: string; normalizedName: string } {
  // Canonical equivalence only: NFC folds canonically identical spellings
  // (e.g. a precomposed accented letter vs. the letter plus a combining
  // mark) onto one row. Compatibility folding (NFKC) is deliberately NOT
  // applied — it would merge display forms organizers may intend as
  // distinct (full- vs half-width) and rewrite their text.
  const name = raw.trim().replace(/\s+/g, " ").normalize("NFC");
  // Lowercasing can decompose (e.g. İ), so normalize again after it.
  return { name, normalizedName: name.toLowerCase().normalize("NFC") };
}

export function getOrCreateDiscipline(db: WritableDb, rawName: string): bigint {
  const { name, normalizedName } = normalizeDisciplineName(rawName);
  requireName(name, "Discipline");
  const existing = db.discipline.normalizedName.find(normalizedName);
  if (existing !== null) {
    return existing.id;
  }
  // Only a new row counts against the cap: reusing an existing discipline
  // stays allowed at any count. Count with an early stop one past the cap,
  // like takeAll's lazy-iterator idiom, so an already over-cap table is
  // seen rather than truncated silently — and the whole table is never
  // materialized to count it.
  let count = 0;
  for (const _row of db.discipline.iter()) {
    count += 1;
    if (count > MAX_DISCIPLINES) {
      break;
    }
  }
  if (count >= MAX_DISCIPLINES) {
    throw new SenderError(`Cannot add a new discipline: the list is limited to ${MAX_DISCIPLINES}`);
  }
  return db.discipline.insert({ id: 0n, name, normalizedName }).id;
}
