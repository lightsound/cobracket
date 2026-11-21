// fallow-ignore-file coverage-gaps -- driven by Vitest as the connection project's globalSetup; the suite's pass/fail is its test, and a global setup is not an import edge (see .fallowrc.jsonc)
// fallow-ignore-file code-duplication -- the standalone driver mechanics are shared with the M1 spike (spacetimedb/spike/verify-read-surfaces.ts) by deliberate mirror: each driver stays self-contained rather than coupling the CI-gated suite to a spike script, or the spike to the suite
/**
 * What the connection-level suite drives, brought up once per run: a
 * real SpacetimeDB standalone (pinned 2.15.0) on a scratch port, with
 * the committed module published to a suite-only database.
 *
 * Nothing here is faked — that is the suite's point (see
 * gating.test.ts's header). The target is asserted local before
 * anything is published: the listen address is loopback, the port is
 * this suite's own, and the database name exists only for this suite,
 * so a run can never publish to — or read from — a named deployment
 * (Maincloud above all).
 *
 * Mechanics mirror the M1 read-surface spike
 * (spacetimedb/spike/verify-read-surfaces.ts), which proved them on
 * the wire first: binaries come from SPACETIME_BIN_DIR or the pinned
 * release tarball cached in .connection-build/bin; the module is
 * assembled as package.json + tsconfig.json + src/ + format/ in the
 * repo's own layout, with the real entry (no fixture, no rewritten
 * index); the server is a detached process group, SIGTERM then
 * SIGKILL on teardown, so no standalone outlives the run. The tests
 * learn the port and database from .connection-build/server.json,
 * written here.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CONNECTION_DIR = dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = join(CONNECTION_DIR, "..");
const BUILD_DIR = join(MODULE_DIR, ".connection-build");
const PORT = Number(process.env.CONNECTION_PORT ?? 3123);
const HOST = `http://127.0.0.1:${PORT}`;
const DB_NAME = "cobracket-connection";
const SERVER_VERSION = "2.15.0";
/**
 * The SHA-256 of the SpacetimeDB 2.15.0 release tarball from the
 * official GitHub release. Verification happens before extraction, so
 * a substituted asset never executes. Refresh this hash together with
 * SERVER_VERSION on every version bump.
 */
const SERVER_TARBALL_SHA256 = "30ee1d0ad345eb479bc269423f1c0f2f21fc564cd634fcb115c248465358b062";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command: string, args: string[], cwd?: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

/**
 * Seed the module secret (ADR 0032) on the database just published,
 * with a fresh host-CSPRNG key. This deliberately bypasses `run`:
 * `run`'s error interpolates the full argument list, which here would
 * print the key itself into the failure log. The error below carries
 * the database, the status, and the CLI's output — never the key —
 * the same shape as the browser gate's seedModule
 * (e2e/global-setup.ts).
 */
function seedModuleSecret(cli: string): void {
  const key = randomBytes(32).toString("hex");
  const result = spawnSync(cli, ["call", DB_NAME, "seed_module_secret", key, "--server", HOST], {
    encoding: "utf8",
  });
  if (result.status === 0) {
    return;
  }
  throw new Error(
    `seeding the module secret on ${DB_NAME} failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
  );
}

function ensureBinaries(): string {
  const override = process.env.SPACETIME_BIN_DIR;
  if (override) {
    return override;
  }
  const binDir = join(BUILD_DIR, "bin");
  if (existsSync(join(binDir, "spacetime"))) {
    return binDir;
  }
  return downloadBinaries(binDir);
}

function verifyTarball(tarball: string): void {
  const actual = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  if (actual !== SERVER_TARBALL_SHA256) {
    throw new Error(
      `SpacetimeDB release tarball SHA-256 mismatch: expected ${SERVER_TARBALL_SHA256}, got ${actual} — refusing to extract ${tarball}`,
    );
  }
}

function downloadBinaries(binDir: string): string {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(
      "the connection suite's binary download covers linux-x64 only; set SPACETIME_BIN_DIR to a directory holding the SpacetimeDB 2.15.0 spacetime + spacetimedb-standalone binaries",
    );
  }
  mkdirSync(binDir, { recursive: true });
  const asset = "spacetime-x86_64-unknown-linux-gnu.tar.gz";
  const url = `https://github.com/clockworklabs/SpacetimeDB/releases/download/v${SERVER_VERSION}/${asset}`;
  const tarball = join(BUILD_DIR, asset);
  run("curl", ["-fSL", "-o", tarball, url]);
  verifyTarball(tarball);
  run("tar", ["xzf", tarball, "-C", binDir, "--no-same-owner"]);
  // The tarball ships the CLI as `spacetimedb-cli`; `spacetime` is the
  // name the install script gives it.
  const cli = join(binDir, "spacetime");
  if (!existsSync(cli) && existsSync(join(binDir, "spacetimedb-cli"))) {
    cpSync(join(binDir, "spacetimedb-cli"), cli);
  }
  return binDir;
}

function assertServerVersion(binDir: string): void {
  const out = run(join(binDir, "spacetimedb-standalone"), ["--version"]);
  if (!out.includes(SERVER_VERSION)) {
    throw new Error(
      `standalone binary reports "${out.trim()}", expected ${SERVER_VERSION} — clear spacetimedb/.connection-build/bin or point SPACETIME_BIN_DIR elsewhere`,
    );
  }
}

function assembleModule(): string {
  const dir = join(BUILD_DIR, "module");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  cpSync(join(MODULE_DIR, "package.json"), join(dir, "package.json"));
  cpSync(join(MODULE_DIR, "tsconfig.json"), join(dir, "tsconfig.json"));
  cpSync(join(MODULE_DIR, "src"), join(dir, "src"), { recursive: true });
  cpSync(join(MODULE_DIR, "format"), join(dir, "format"), { recursive: true });
  cpSync(join(MODULE_DIR, "lifecycle"), join(dir, "lifecycle"), { recursive: true });
  return dir;
}

function jwtKeyPaths(): { pub: string; priv: string } {
  const cliKeys = join(homedir(), ".config", "spacetime");
  const pub = join(cliKeys, "id_ecdsa.pub");
  const priv = join(cliKeys, "id_ecdsa");
  if (existsSync(pub) && existsSync(priv)) {
    return { pub, priv };
  }
  // A fresh standalone data dir needs explicit key paths (the
  // generated config.toml leaves the CA paths commented out). When
  // the CLI's own key pair is absent, mint an equivalent ES256 pair
  // under the build dir. The private key must be PKCS#8 — the form
  // the CLI itself writes; a SEC1 EC key (openssl ecparam's output)
  // is rejected with InvalidKeyFormat (measured on a fresh-HOME run,
  // the case CI always hits).
  const keyDir = join(BUILD_DIR, "keys");
  mkdirSync(keyDir, { recursive: true });
  const generated = join(keyDir, "id_ecdsa");
  if (
    existsSync(generated) &&
    !readFileSync(generated, "utf8").startsWith("-----BEGIN PRIVATE KEY-----")
  ) {
    rmSync(generated, { force: true });
    rmSync(`${generated}.pub`, { force: true });
  }
  if (!existsSync(generated)) {
    run("openssl", [
      "genpkey",
      "-algorithm",
      "EC",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-out",
      generated,
    ]);
    run("openssl", ["pkey", "-in", generated, "-pubout", "-out", `${generated}.pub`]);
  }
  return { pub: `${generated}.pub`, priv: generated };
}

function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tcpConnect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await portIsOpen(port)) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`standalone did not start listening on ${port}`);
    }
    await sleep(250);
  }
}

async function startServer(standalone: string): Promise<ReturnType<typeof spawn>> {
  if (!HOST.startsWith("http://127.0.0.1:")) {
    throw new Error(`connection suite target is not loopback: ${HOST}`);
  }
  if (await portIsOpen(PORT)) {
    throw new Error(`port ${PORT} is already in use — stop that server or set CONNECTION_PORT`);
  }
  const dataDir = join(BUILD_DIR, "server-data");
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const keys = jwtKeyPaths();
  const server = spawn(
    standalone,
    [
      "start",
      "--data-dir",
      dataDir,
      "--jwt-pub-key-path",
      keys.pub,
      "--jwt-priv-key-path",
      keys.priv,
      "--listen-addr",
      `127.0.0.1:${PORT}`,
      "--non-interactive",
    ],
    { detached: true, stdio: "ignore" },
  );
  try {
    await waitForPort(PORT, 30_000);
  } catch (error) {
    await stopServer(server);
    throw error;
  }
  return server;
}

async function stopServer(server: ReturnType<typeof spawn>): Promise<void> {
  if (server.pid === undefined) {
    return;
  }
  const pid = server.pid;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
  await sleep(500);
  try {
    process.kill(-pid, 0);
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is gone — the expected path.
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  const binDir = ensureBinaries();
  assertServerVersion(binDir);
  const moduleDir = assembleModule();
  const server = await startServer(join(binDir, "spacetimedb-standalone"));
  try {
    run(join(binDir, "spacetime"), [
      "publish",
      "--server",
      HOST,
      "--module-path",
      moduleDir,
      DB_NAME,
    ]);
    // Seed the module secret (ADR 0032) immediately after publishing,
    // before anything else can bind an identity: a host-CSPRNG key for
    // this run's throwaway database, called with the same CLI idiom as
    // the publish (explicit --server, suite-local target).
    seedModuleSecret(join(binDir, "spacetime"));
  } catch (error) {
    await stopServer(server);
    throw error;
  }
  writeFileSync(join(BUILD_DIR, "server.json"), JSON.stringify({ port: PORT, database: DB_NAME }));
  return async () => {
    await stopServer(server);
  };
}
