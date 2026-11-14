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

// --- binaries ---------------------------------------------------------------

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
  run("tar", ["xzf", tarball, "-C", binDir, "--no-same-owner"]);
  // The tarball ships the CLI as `spacetimedb-cli`; `spacetime` is the
  // name the install script gives it.
  const cli = join(binDir, "spacetime");
  if (!existsSync(cli) && existsSync(join(binDir, "spacetimedb-cli"))) {
    cpSync(join(binDir, "spacetimedb-cli"), cli);
  }
  return binDir;
}

// The probes assert wire behavior of one exact server release; a
// stale or foreign binary in the bin dir must fail loudly rather than
// prove things about the wrong server.
function assertServerVersion(binDir: string): void {
  const out = run(join(binDir, "spacetimedb-standalone"), ["--version"]);
  if (!out.includes(SERVER_VERSION)) {
    throw new Error(
      `standalone binary reports "${out.trim()}", expected ${SERVER_VERSION} — clear spacetimedb/.connection-build/bin or point SPACETIME_BIN_DIR elsewhere`,
    );
  }
}

// --- module assembly ----------------------------------------------------------

function assembleModule(): string {
  const dir = join(BUILD_DIR, "module");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  cpSync(join(MODULE_DIR, "package.json"), join(dir, "package.json"));
  cpSync(join(MODULE_DIR, "tsconfig.json"), join(dir, "tsconfig.json"));
  cpSync(join(MODULE_DIR, "src"), join(dir, "src"), { recursive: true });
  // The format engine sits beside src/ in the repo layout, and the
  // module's library imports it as ../../format — keep the layout.
  cpSync(join(MODULE_DIR, "format"), join(dir, "format"), { recursive: true });
  return dir;
}

// --- server lifecycle ---------------------------------------------------------

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
  // A cached key in the rejected SEC1 form (minted before the form
  // was pinned) is regenerated, not reused.
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
  // The local-target assertion, in the spike's and the e2e gate's
  // spirit: loopback host, this suite's own port, free before the
  // child starts — a foreign server already listening there would
  // silently take the publish and the probes.
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
    // The child is detached: if startup fails it must not be left
    // running behind the suite's back.
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
  // Escalate if the group ignores SIGTERM: a leaked standalone would
  // hold the port and poison the next run.
  await sleep(500);
  try {
    process.kill(-pid, 0);
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is gone — the expected path.
  }
}

// --- the setup entry ------------------------------------------------------------

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
  } catch (error) {
    await stopServer(server);
    throw error;
  }
  writeFileSync(join(BUILD_DIR, "server.json"), JSON.stringify({ port: PORT, database: DB_NAME }));
  return async () => {
    await stopServer(server);
  };
}
