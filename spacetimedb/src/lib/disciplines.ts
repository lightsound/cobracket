import type { WritableDb } from "./binding";
import { requireName } from "./limits";

// Discipline normalization and dedup, the successor of
// convex/model/disciplines.ts.

export function normalizeDisciplineName(raw: string): { name: string; normalizedName: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  return { name, normalizedName: name.toLowerCase() };
}

// Disciplines are freeform organizer input, normalized into rows so the
// same discipline entered twice (case/spacing aside) is one row
// (story 2). The unique index on normalizedName is the probe.
export function getOrCreateDiscipline(db: WritableDb, rawName: string): bigint {
  const { name, normalizedName } = normalizeDisciplineName(rawName);
  requireName(name, "Discipline");
  const existing = db.discipline.normalizedName.find(normalizedName);
  if (existing !== null) {
    return existing.id;
  }
  return db.discipline.insert({ id: 0n, name, normalizedName }).id;
}
