/// <reference types="bun" />
// fallow-ignore-file coverage-gaps -- driven as a subprocess by `bun run spacetime:seed:local`; its exit code is its verdict, and a subprocess is not an import edge (see .fallowrc.jsonc)
/**
 * Seed a local standalone's module secret (ADR 0032), the second half
 * of `bun run spacetime:publish:local`.
 *
 * The key lives in `.spacetime-secret` at the repo root (gitignored,
 * created here with host-CSPRNG bytes on first use), so a developer's
 * local database keeps one stable secret across republishes — the
 * same role the owner's password-manager copy plays at provisioning.
 * The reducer refuses a second seed, which makes this script's
 * idempotence question real: a re-run whose stored key is the key the
 * database was seeded with is a success, while a database seeded with
 * a *different* key must fail loudly rather than leave the developer
 * believing their file's key is in force. The two are distinguishable
 * exactly when it matters: if this run had to create the key file, the
 * key in it is new, so an "already seeded" refusal can only mean the
 * database holds another key — the deleted-file case — and the script
 * fails with the remedy. If the file already existed, the refusal is
 * the ordinary re-run of this same flow, and the script reports the
 * database as seeded. (A database seeded out of band with another key
 * while a stale file sits on disk is not distinguishable from here —
 * the secret is private by design, so nothing can read it back for a
 * comparison; deleting the local database is the reset either way.)
 *
 * Run it with:
 *
 *   bun run spacetime:seed:local
 *
 * against the `spacetime start` server from AGENTS.md's workflow.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECRET_FILE = join(ROOT, ".spacetime-secret");
const DB_NAME = "cobracket";

function fail(message: string): never {
  console.error(`spacetime:seed:local: ${message}`);
  process.exit(1);
}

const created = !existsSync(SECRET_FILE);
if (created) {
  writeFileSync(SECRET_FILE, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
  console.log("spacetime:seed:local: created .spacetime-secret with a fresh key");
}
const keyHex = readFileSync(SECRET_FILE, "utf8").trim();
if (!/^[0-9a-f]{64}$/.test(keyHex)) {
  fail(".spacetime-secret does not hold a 32-byte hex key — fix or delete the file and re-run");
}

const result = spawnSync(
  "spacetime",
  ["call", DB_NAME, "seed_module_secret", keyHex, "--server", "local"],
  { encoding: "utf8" },
);
const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (result.status === 0) {
  console.log("spacetime:seed:local: module secret seeded on the local database");
} else if (output.includes("already seeded")) {
  if (created) {
    fail(
      "the local database is already seeded with a different key (this run created a fresh .spacetime-secret, so the seeded key cannot be the one in it). " +
        "Restore the original .spacetime-secret, or delete the local database and publish + seed again",
    );
  }
  console.log("spacetime:seed:local: module secret already seeded — nothing to do");
} else {
  fail(`spacetime call seed_module_secret failed (${result.status}):\n${output.trim()}`);
}
