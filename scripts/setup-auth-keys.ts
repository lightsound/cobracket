#!/usr/bin/env bun
/**
 * Headless Convex Auth v2 key setup (ADR 0003).
 *
 * The auth core component signs access tokens with an RS256 key it reads from
 * the AUTH_PRIVATE_KEY / AUTH_JWKS deployment env vars. The upstream
 * `npx @convex-dev/auth` wizard also scaffolds files and expects a TTY; this
 * script does only the key half, non-interactively, so it works against the
 * anonymous local backend and in CI.
 *
 * Idempotent: existing keys are left untouched (rotate by deleting both vars
 * first). Run with the same env the Convex CLI needs, e.g.
 * `CONVEX_AGENT_MODE=anonymous bun run auth:keys`.
 */
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

function convexEnv(args: string[]): { ok: boolean; stdout: string } {
  const result = Bun.spawnSync(["bun", "x", "convex", ...args], {
    stdout: "pipe",
    // The CLI echoes values it reads/writes; keep the private key off the log.
    stderr: "pipe",
  });
  return { ok: result.exitCode === 0, stdout: result.stdout.toString().trim() };
}

const existing = convexEnv(["env", "get", "AUTH_PRIVATE_KEY"]);
if (existing.ok && existing.stdout.length > 0) {
  console.log("AUTH_PRIVATE_KEY and AUTH_JWKS are already set — left unchanged.");
  process.exit(0);
}

const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const privatePem = await exportPKCS8(privateKey);
const publicJwk = await exportJWK(publicKey);
const jwks = JSON.stringify({
  keys: [{ ...publicJwk, kid: crypto.randomUUID(), alg: "RS256", use: "sig" }],
});

// NAME=VALUE form: the CLI would parse a leading "-" in a bare value as a
// flag. Base64 avoids newlines in the PEM (the component atob()s it back).
const privateKeyB64 = Buffer.from(privatePem).toString("base64");
for (const [name, value] of [
  ["AUTH_PRIVATE_KEY", privateKeyB64],
  ["AUTH_JWKS", jwks],
] as const) {
  const set = convexEnv(["env", "set", `${name}=${value}`]);
  if (!set.ok) {
    console.error(`Could not set ${name} on the Convex deployment.`);
    process.exit(1);
  }
  console.log(`Set ${name} on the Convex deployment.`);
}
