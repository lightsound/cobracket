import { t } from "spacetimedb/server";
import { seedModuleSecret as applyModuleSecretSeed } from "./lib";
import { spacetimedb } from "./schema";

export const seedModuleSecret = spacetimedb.reducer({ keyHex: t.string() }, (ctx, { keyHex }) => {
  applyModuleSecretSeed(ctx.db, keyHex);
});
