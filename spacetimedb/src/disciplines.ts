import { t } from "spacetimedb/server";
import { normalizeDisciplineName } from "./lib";
import { spacetimedb } from "./schema";

const DisciplineSuggestionRow = t.row("DisciplineSuggestionRow", { name: t.string() });

// Suggestions for the freeform Discipline field (story 2): prefix
// search on the normalized form, the successor of
// convex/disciplines.ts's suggestDisciplines. Public on purpose —
// discipline names are not organizer-private, and the create form
// runs before any tournament exists — so this is an anonymous view:
// no sender, no binding. A view returns rows, not bare strings: the
// display name rides in a one-field row.
//
// The scan is in memory, deliberately: the normalizedName unique
// index exposes only find (no range), and Range-based index scans
// proved unusable from module code under the test harness — a Range
// built from the module's own "spacetimedb/server" import fails the
// runtime's instanceof check (the harness bundles its own SDK copy)
// and is serialized as a point value instead, on single- and
// multi-column indexes alike (measured, 2026-11-15). Discipline rows
// are few and organizer-created, so filtering and sorting the table
// in the view is bounded in practice; the behavior mirrors Convex's
// range scan exactly (normalized order, first ten).
export const suggestDisciplines = spacetimedb.anonymousView(
  { name: "suggest_disciplines", public: true },
  { prefix: t.string() },
  t.array(DisciplineSuggestionRow),
  (ctx, { prefix }) => {
    const { normalizedName } = normalizeDisciplineName(prefix);
    if (normalizedName === "") {
      return [];
    }
    // The filter reproduces Convex's range [prefix, prefix + "\uffff")
    // exactly, including its exclusive end: a name whose next
    // character after the prefix is U+FFFF falls outside. The sort is
    // JS code-unit order, which agrees with the index order for BMP
    // names.
    // oxlint-disable-next-line unicorn/no-useless-spread -- SpacetimeDB table iterators are lazy; the spread is what materializes them
    return [...ctx.db.discipline.iter()]
      .filter(
        (discipline) =>
          discipline.normalizedName.startsWith(normalizedName) &&
          !discipline.normalizedName.startsWith(`${normalizedName}\uffff`),
      )
      .sort((a, b) =>
        a.normalizedName < b.normalizedName ? -1 : a.normalizedName > b.normalizedName ? 1 : 0,
      )
      .slice(0, 10)
      .map((discipline) => ({ name: discipline.name }));
  },
);
