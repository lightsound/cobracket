import { t } from "spacetimedb/server";

export const formatArg = t.enum("TournamentFormatArg", {
  single_elimination: t.unit(),
  double_elimination: t.object("DoubleEliminationFormatArg", {
    grandFinalReset: t.bool().optional(),
  }),
});

export type FormatArg = typeof formatArg.type;
