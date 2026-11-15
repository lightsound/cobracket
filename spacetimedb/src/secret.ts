import { t } from "spacetimedb/server";
import { seedModuleSecret as applyModuleSecretSeed } from "./lib";
import { spacetimedb } from "./schema";

// Provisioning (ADR 0032): the one reducer that is not an Organizer
// operation. Publishing a fresh database is immediately followed by
// seeding its module secret — the publish drivers (the connection,
// live, and e2e suites, and `bun run spacetime:publish:local` for a
// developer's standalone) call this with a host-CSPRNG key before the
// database is used for anything else. The rules live in lib/secret.ts:
// a 32-byte hex key, refused when a secret already exists or any
// identity has bound, and seeding itself binds nobody.
export const seedModuleSecret = spacetimedb.reducer({ keyHex: t.string() }, (ctx, { keyHex }) => {
  applyModuleSecretSeed(ctx.db, keyHex);
});
