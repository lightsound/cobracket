import { t } from "spacetimedb/server";

// Argument-surface shapes, the successor of convex/model/validators.ts
// (the stored shapes live in schema.ts). Args accept grandFinalReset
// as optional (defaulting to on, per the spec); the stored form keeps
// it required.
export const formatArg = t.enum("TournamentFormatArg", {
  single_elimination: t.unit(),
  double_elimination: t.object("DoubleEliminationFormatArg", {
    grandFinalReset: t.bool().optional(),
  }),
});

export type FormatArg = typeof formatArg.type;
