// fallow-ignore-file code-duplication -- the standalone driver mechanics are shared with the connection suite (spacetimedb/connection/global-setup.ts) and the live suite (src/lib/spacetimedb.live.test.tsx) by deliberate mirror: each driver stays self-contained rather than coupling CI-gated suites to one another; the connection suite's driver carries the same suppression for the same reason
/**
 * What the browser gate drives, brought up once per run: a local
 * SpacetimeDB standalone with the real module published to it, and the
 * app's dev server in `--mode e2e` with the SpacetimeDB backend selected
 * (`VITE_BACKEND=spacetimedb`).
 *
 * Nothing here is faked. The gate exists because the happy-dom one, which
 * replaces the data seam (`src/test-fakes.ts`), let a real-browser finding
 * through — so this one keeps the seam real: the page connects tokenless,
 * subscribes over the websocket and runs the same reducers an Organizer
 * does. Auth, subscriptions and the bracket are all under the capture.
 * Since migration slice M4 the backend under the gate is SpacetimeDB;
 * production still serves Convex until the M5 cutover, so for that window
 * the gate proves the backend that is not yet serving — the coverage
 * inversion the migration plan records as known and accepted.
 *
 * Three ways in, in order of preference:
 *
 * 1. `E2E_BASE_URL` set — the caller runs the app (their own backend and
 *    a `bun dev --mode e2e`); nothing is started or stopped here.
 * 2. `.env.local` selects the SpacetimeDB backend and names a *local*
 *    host that answers — the long-running `spacetime start` from
 *    AGENTS.md's workflow — so no server is started here. The server
 *    process is reused; its published state is not: a long-running
 *    standalone republishes nothing itself, so the current module is
 *    published to that host and database first, and only the dev server
 *    starts, pointed at exactly that host and database.
 * 3. Neither (CI, a fresh container, a developer whose `.env.local` names
 *    the Convex backend) — a standalone starts too, on this gate's own
 *    port, the module is published to a database that exists only for
 *    this gate, and the dev server starts against it. There is no keys
 *    dance and no restart: the standalone is handed an ES256 key pair to
 *    sign connection tokens with (below), and that is the whole of it —
 *    the anonymous-Convex boot's `auth:keys` restart has no counterpart.
 *
 * The gate never publishes to a target it did not choose, and mode 3's
 * target is local by construction before it is local by assertion: the
 * host string is built in this file from a loopback literal and the
 * gate's own port, the port is asserted free before the server starts (a
 * foreign server already listening would silently take the publish), the
 * database name is a constant of this file, and the publish passes
 * `--server` explicitly, so no CLI default (a developer's configured
 * default server, a stray environment variable) can redirect it to
 * Maincloud. What the app is pointed at is asserted local before it
 * starts. The dev server receives its backend configuration in its
 * environment, which Vite ranks above any `.env` file, so in mode 3 a
 * `.env.local` pointing elsewhere reaches neither the publish nor the
 * app. Nothing here writes `.env.local`: the old boot snapshotted and
 * restored it because the anonymous Convex CLI saved its deployment
 * there whatever it was told to read; no counterpart exists now, and
 * that side effect is gone with the CLI.
 *
 * The standalone driver mirrors the connection suite's
 * (`spacetimedb/connection/global-setup.ts`) and the live suite's
 * (`src/lib/spacetimedb.live.test.tsx`) deliberately — each driver stays
 * self-contained rather than coupling CI-gated suites to one another.
 * Binaries come from `SPACETIME_BIN_DIR`, the connection suite's cached
 * store, or the pinned release tarball downloaded into this gate's own
 * build directory; both binaries' versions are asserted (2.15.0) before
 * it is trusted with the publish; the module is assembled as
 * package.json + tsconfig.json + src/ + format/ in the repo's own
 * layout — the real entry, nothing rewritten; the data directory is
 * fresh per run, so the gate's database starts empty. After every
 * publish the module secret is seeded (ADR 0032) with a fresh
 * host-CSPRNG key, before the app starts (see seedModule below).
 *
 * The signing keys: a fresh standalone data directory needs explicit key
 * paths (its generated config leaves the CA paths commented out), so the
 * CLI's own pair under `~/.config/spacetime` serves when it exists, and
 * otherwise an equivalent ES256 pair is minted under the build
 * directory. The private key must be PKCS#8 — the form the CLI itself
 * writes; a SEC1 EC key (openssl ecparam's output) is rejected with
 * InvalidKeyFormat (measured by the connection suite on a fresh-HOME
 * run, the case CI always hits), so keys are minted with
 * `openssl genpkey`, and a cached key in the rejected form is
 * regenerated rather than reused.
 *
 * Children run in their own process group and the group is what gets
 * killed: the dev server spawns children of its own, and killing a
 * leader alone leaves a server on its port for the next run to trip
 * over.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect as tcpConnect, createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import type { TestProject } from "vite-plus/test/node";

declare module "vitest" {
  interface ProvidedContext {
    e2eBaseUrl: string;
  }
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV_LOCAL = join(ROOT, ".env.local");
/**
 * The store the gate falls back to when `PLAYWRIGHT_BROWSERS_PATH` names
 * one that lacks the pinned build: a directory of its own, so that store
 * is never written to. It is playwright's own default on Linux (macOS and
 * Windows default elsewhere, which only matters when the variable is
 * unset — then playwright chooses, and this constant is not used).
 */
const BROWSER_CACHE = join(homedir(), ".cache", "ms-playwright");
const SPACETIMEDB_DIR = join(ROOT, "spacetimedb");
const BUILD_DIR = join(SPACETIMEDB_DIR, ".e2e-build");
const MODULE_DIR = join(BUILD_DIR, "module");
const DATA_DIR = join(BUILD_DIR, "server-data");
/** This gate's own port (the connection suite's is 3123, the live suite's 3124). */
const PORT = Number(process.env.E2E_SPACETIME_PORT ?? 3125);
const HOST = `http://127.0.0.1:${PORT}`;
/** A database that exists only for this gate; never an environment input. */
const DB_NAME = "cobracket-e2e";
const SERVER_VERSION = "2.15.0";
/**
 * The SHA-256 of the SpacetimeDB 2.15.0 release tarball from the
 * official GitHub release. Verification happens before extraction, so
 * a substituted asset never executes. Refresh this hash together with
 * SERVER_VERSION on every version bump.
 */
const SERVER_TARBALL_SHA256 = "30ee1d0ad345eb479bc269423f1c0f2f21fc564cd634fcb115c248465358b062";

interface Child {
  label: string;
  process: ChildProcess;
  /** The last lines of output, for the failure message. */
  tail: string[];
}

/** Colour codes chalk emits when `FORCE_COLOR` is set even on a pipe. */
const ANSI_CODE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
function stripAnsi(line: string): string {
  return line.replace(ANSI_CODE, "");
}

function start(label: string, command: string[], env: NodeJS.ProcessEnv): Child {
  const child = spawn(command[0]!, command.slice(1), {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const lines: string[] = [];
  const onLine = (raw: string) => {
    lines.push(stripAnsi(raw));
  };
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      const parts = (rest + chunk).split(/\r?\n/);
      rest = parts.pop() ?? "";
      for (const part of parts) onLine(part);
    });
  }
  child.on("exit", (code, signal) => {
    onLine(`exited (${code ?? signal})`);
  });

  return {
    label,
    process: child,
    get tail() {
      return lines.slice(-30);
    },
  };
}

function alive(child: ChildProcess): child is ChildProcess & { pid: number } {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

/** Whether any process of the group led by `pid` still exists (signal 0 probes). */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

/** Poll `done` until it holds or `timeoutMs` passes; true when it held. */
async function settles(done: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (done()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return done();
}

/**
 * Take a child's whole process group down, and wait until it is gone —
 * every member, not just the leader. The dev server is a `bun run`
 * leader with servers below it; the leader exits on SIGTERM at once, and
 * a teardown that only waited for it left a backend behind on its port
 * (measured once, on the old boot, on a run that otherwise passed). So
 * the wait is on the group, and a group that outlives the grace period
 * is killed outright.
 */
async function stop(child: Child): Promise<void> {
  const { pid } = child.process;
  if (pid === undefined || !groupAlive(pid)) return;
  signalGroup(pid, "SIGTERM");
  if (await settles(() => !groupAlive(pid), 5000)) return;
  signalGroup(pid, "SIGKILL");
  await settles(() => !groupAlive(pid), 5000);
}

/** Whether anything at all answers HTTP at `url` (a listener, not a health check). */
async function listening(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
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
    if (await portIsOpen(port)) return;
    if (Date.now() > deadline) {
      throw new Error(`standalone did not start listening on ${port}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** `.env.local` as it is, or nothing when there is no such file. */
function readEnvLocal(): string | undefined {
  try {
    return readFileSync(ENV_LOCAL, "utf8");
  } catch {
    return undefined;
  }
}

/** One `NAME=value` entry from `.env.local`, if the file exists and names one. */
function envLocalValue(name: string): string | undefined {
  const env = readEnvLocal();
  if (env === undefined) return undefined;
  const pattern = new RegExp(`^${name}=(.+)$`, "m");
  return pattern.exec(env)?.[1]?.trim();
}

/**
 * Reuse only a local backend: a `.env.local` can name a cloud host, and
 * the gate writes real tournaments through whatever it reaches. An
 * unparseable value is not a local URL — mode 2 falls through to mode 3
 * rather than dying on the parse.
 */
function isLocal(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

/** Run a command to completion, or throw with its output. */
function run(command: string, args: string[], cwd?: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

// --- the standalone driver (mirrors the connection suite's) ---------------

function ensureBinaries(): string {
  const override = process.env.SPACETIME_BIN_DIR;
  if (override !== undefined) return override;
  const shared = join(SPACETIMEDB_DIR, ".connection-build", "bin");
  if (existsSync(join(shared, "spacetime"))) return shared;
  const binDir = join(BUILD_DIR, "bin");
  if (existsSync(join(binDir, "spacetime"))) return binDir;
  return downloadBinaries(binDir);
}

/** Fail closed unless the downloaded tarball matches the pinned hash. */
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
      "the browser gate's binary download covers linux-x64 only; set SPACETIME_BIN_DIR to a directory holding the SpacetimeDB 2.15.0 spacetime + spacetimedb-standalone binaries",
    );
  }
  mkdirSync(binDir, { recursive: true });
  const asset = "spacetime-x86_64-unknown-linux-gnu.tar.gz";
  const url = `https://github.com/clockworklabs/SpacetimeDB/releases/download/v${SERVER_VERSION}/${asset}`;
  const tarball = join(BUILD_DIR, asset);
  run("curl", ["-fSL", "-o", tarball, url]);
  verifyTarball(tarball);
  run("tar", ["xzf", tarball, "-C", binDir, "--no-same-owner"]);
  renameCliBinary(binDir);
  return binDir;
}

/** The tarball ships the CLI as `spacetimedb-cli`; `spacetime` is the name the install script gives it. */
function renameCliBinary(binDir: string): void {
  const cli = join(binDir, "spacetime");
  if (!existsSync(cli) && existsSync(join(binDir, "spacetimedb-cli"))) {
    cpSync(join(binDir, "spacetimedb-cli"), cli);
  }
}

// The gate asserts wire behavior of one exact server release; a stale
// or foreign binary in the bin dir must fail loudly rather than prove
// things about the wrong server. Both binaries are asserted — the
// standalone serves and the CLI publishes, and a mismatched pair is a
// wrong proof either way.
function assertBinaryVersions(binDir: string): void {
  for (const binary of ["spacetimedb-standalone", "spacetime"]) {
    const out = run(join(binDir, binary), ["--version"]);
    if (!out.includes(SERVER_VERSION)) {
      throw new Error(
        `${binary} reports "${out.trim()}", expected ${SERVER_VERSION} — clear spacetimedb/.e2e-build/bin and spacetimedb/.connection-build/bin or point SPACETIME_BIN_DIR elsewhere`,
      );
    }
  }
}

function assembleModule(): void {
  rmSync(MODULE_DIR, { recursive: true, force: true });
  mkdirSync(MODULE_DIR, { recursive: true });
  for (const file of ["package.json", "tsconfig.json"]) {
    writeFileSync(join(MODULE_DIR, file), readFileSync(join(SPACETIMEDB_DIR, file)));
  }
  cpSync(join(SPACETIMEDB_DIR, "src"), join(MODULE_DIR, "src"), { recursive: true });
  // The format engine sits beside src/ in the repo layout, and the
  // module's library imports it as ../../format — keep the layout.
  cpSync(join(SPACETIMEDB_DIR, "format"), join(MODULE_DIR, "format"), { recursive: true });
}

function jwtKeyPaths(): { pub: string; priv: string } {
  return cliKeyPaths() ?? generatedKeyPaths();
}

/** The CLI's own pair, when it exists. */
function cliKeyPaths(): { pub: string; priv: string } | undefined {
  const cliKeys = join(homedir(), ".config", "spacetime");
  const pub = join(cliKeys, "id_ecdsa.pub");
  const priv = join(cliKeys, "id_ecdsa");
  return existsSync(pub) && existsSync(priv) ? { pub, priv } : undefined;
}

function generatedKeyPaths(): { pub: string; priv: string } {
  const keyDir = join(BUILD_DIR, "keys");
  mkdirSync(keyDir, { recursive: true });
  const generated = join(keyDir, "id_ecdsa");
  dropRejectedKey(generated);
  if (!existsSync(generated)) mintKeyPair(generated);
  // The public half is re-derived either way, so a `.pub` that went
  // missing — or was left by another key — cannot reach the server as
  // half of a mismatched pair.
  else derivePublicKey(generated);
  return { pub: `${generated}.pub`, priv: generated };
}

/** A cached key in the rejected SEC1 form is regenerated, not reused (see the file comment). */
function dropRejectedKey(generated: string): void {
  if (
    existsSync(generated) &&
    !readFileSync(generated, "utf8").startsWith("-----BEGIN PRIVATE KEY-----")
  ) {
    rmSync(generated, { force: true });
    rmSync(`${generated}.pub`, { force: true });
  }
}

function mintKeyPair(generated: string): void {
  run("openssl", [
    "genpkey",
    "-algorithm",
    "EC",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-out",
    generated,
  ]);
  derivePublicKey(generated);
}

function derivePublicKey(generated: string): void {
  run("openssl", ["pkey", "-in", generated, "-pubout", "-out", `${generated}.pub`]);
}

/**
 * Publish the assembled module to `db` on `host`. `--server` is named
 * explicitly: the target never comes from the CLI's configured default,
 * which a developer may have set to a named deployment — Maincloud
 * above all. Callers pass only targets they have asserted local.
 */
function publishModule(binDir: string, host: string, db: string): void {
  run(join(binDir, "spacetime"), ["publish", "--server", host, "--module-path", MODULE_DIR, db]);
}

/**
 * Seed the module secret (ADR 0032) on a database this gate just
 * published to, with a fresh host-CSPRNG key — tournament creation
 * mints share slugs from the secret, so an unseeded database would
 * refuse the scenario's first write. Mode 3's database is fresh, so
 * the seed always lands there. Mode 2 republishes to a developer's
 * long-running standalone, whose database the local flow may already
 * have seeded: that one refusal ("already seeded") is the state the
 * gate needs anyway, so it is accepted; any other failure is real.
 */
function seedModule(binDir: string, host: string, db: string): void {
  const key = randomBytes(32).toString("hex");
  const result = spawnSync(
    join(binDir, "spacetime"),
    ["call", db, "seed_module_secret", key, "--server", host],
    { encoding: "utf8" },
  );
  if (result.status === 0) return;
  const output = `${result.stdout}
${result.stderr}`;
  if (output.includes("already seeded")) return;
  throw new Error(`seeding the module secret on ${db} failed (${result.status}):
${output}`);
}

// --- the browser ------------------------------------------------------------

/**
 * Whether the headless Chromium the pinned playwright-core wants is where it
 * looks. Launching is the one public way to ask: the registry resolves the
 * store from `PLAYWRIGHT_BROWSERS_PATH` once, at module load, so there is no
 * path to check that would also be the path the test workers use.
 */
async function chromiumLaunches(): Promise<boolean> {
  try {
    const browser = await chromium.launch();
    await browser.close();
    return true;
  } catch (error) {
    if (/Executable doesn't exist/.test(String(error))) return false;
    throw error;
  }
}

/**
 * Make sure the browser the gate drives exists, like the standalone
 * binary the gate downloads on first use: `playwright-core` is pinned
 * exactly and downloads nothing on install, so the build it wants is a
 * download the gate owns. With `PLAYWRIGHT_BROWSERS_PATH` unset the
 * headless shell goes where playwright puts browsers on this platform,
 * the same place a `playwright-core install` by hand would. A store the
 * variable points at that carries a different build — the hosted agent
 * images preinstall one and set the variable to it — is left alone: the
 * shell goes to `BROWSER_CACHE` and the workers are pointed there, which
 * is why this runs before the servers start, in the process the workers
 * inherit their environment from. The preinstalled build is not a
 * substitute (measured: Chromium 141 through `executablePath` on this
 * scenario tripped `[HOT_SCOPE_TIME]` twice at 8.1ms and 8.3ms, where the
 * pinned headless shell passes). The headless shell is all a headless
 * launch needs; CI's `install chromium` carries it too.
 */
async function ensureChromium(): Promise<void> {
  if (await chromiumLaunches()) return;
  const store = process.env.PLAYWRIGHT_BROWSERS_PATH === undefined ? undefined : BROWSER_CACHE;
  installHeadlessShell(store);
  if (store !== undefined) process.env.PLAYWRIGHT_BROWSERS_PATH = store;
}

/** `playwright-core install` of the headless shell, into `store` or playwright's own default. */
function installHeadlessShell(store: string | undefined): void {
  const install = spawnSync("bun", ["x", "playwright-core", "install", "chromium-headless-shell"], {
    cwd: ROOT,
    env: store === undefined ? process.env : { ...process.env, PLAYWRIGHT_BROWSERS_PATH: store },
    encoding: "utf8",
  });
  if (install.status !== 0) {
    throw new Error(
      `playwright-core install failed (${install.status}):\n${install.stdout}\n${install.stderr}`,
    );
  }
}

// --- the backend --------------------------------------------------------------

/** What the gate runs against, and how to take down what it started. */
interface Backend {
  host: string;
  db: string;
  teardown: () => Promise<void>;
}

/** The backend `.env.local` selects, when it selects SpacetimeDB in full. */
function envLocalBackend(): { host: string; db: string } | undefined {
  if (envLocalValue("VITE_BACKEND") !== "spacetimedb") return undefined;
  const host = envLocalValue("VITE_SPACETIMEDB_HOST");
  const db = envLocalValue("VITE_SPACETIMEDB_DB");
  if (host === undefined || db === undefined) return undefined;
  return { host, db };
}

/**
 * The local standalone `.env.local` selects, if one is up — the
 * long-running `spacetime start` from AGENTS.md's workflow. All three
 * configuration values must be there and the host must be local and
 * answering; anything less is mode 3's business, not a half-reuse. The
 * current module is then published to it (see the file comment): the
 * gate proves the current module, not whatever an earlier publish left
 * in the database.
 */
async function runningSpacetime(): Promise<Backend | undefined> {
  const selected = envLocalBackend();
  if (selected === undefined || !isLocal(selected.host)) return undefined;
  if (!(await listening(selected.host))) return undefined;
  const binDir = ensureBinaries();
  assertBinaryVersions(binDir);
  assembleModule();
  publishModule(binDir, selected.host, selected.db);
  seedModule(binDir, selected.host, selected.db);
  return { ...selected, teardown: async () => {} };
}

/** An unusable `E2E_SPACETIME_PORT` fails here, by name, not as a 60-second wait downstream. */
function assertUsablePort(): void {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error(`E2E_SPACETIME_PORT is not a usable port: ${process.env.E2E_SPACETIME_PORT}`);
  }
}

/**
 * Start the gate's own standalone and publish the real module to the
 * gate's own database. The local-target assertion, in the connection
 * suite's form: a loopback host built in this file, the gate's own
 * port, free before the child starts — a foreign server already
 * listening there would silently take the publish and the proof.
 */
async function startSpacetime(): Promise<Backend> {
  assertUsablePort();
  const binDir = ensureBinaries();
  assertBinaryVersions(binDir);
  assembleModule();
  if (!HOST.startsWith("http://127.0.0.1:")) {
    throw new Error(`browser gate target is not loopback: ${HOST}`);
  }
  if (await portIsOpen(PORT)) {
    throw new Error(`port ${PORT} is already in use — stop that server or set E2E_SPACETIME_PORT`);
  }
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const keys = jwtKeyPaths();
  const server = start(
    "spacetimedb-standalone",
    [
      join(binDir, "spacetimedb-standalone"),
      "start",
      "--data-dir",
      DATA_DIR,
      "--jwt-pub-key-path",
      keys.pub,
      "--jwt-priv-key-path",
      keys.priv,
      "--listen-addr",
      `127.0.0.1:${PORT}`,
      "--non-interactive",
    ],
    process.env,
  );
  try {
    await waitForPort(PORT, 60_000);
    publishModule(binDir, HOST, DB_NAME);
    seedModule(binDir, HOST, DB_NAME);
  } catch (error) {
    // The caller only learns of the child on success, so a boot that
    // gives up has to take the process group down here — otherwise the
    // standalone stays on its port and the next run trips over it.
    await stop(server);
    throw error;
  }
  return {
    host: HOST,
    db: DB_NAME,
    teardown: async () => {
      await stop(server);
    },
  };
}

/** Make sure a local backend is up with the module published, and say where it is. */
async function ensureBackend(): Promise<Backend> {
  const running = await runningSpacetime();
  if (running !== undefined) return running;
  return startSpacetime();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : undefined;
      server.close(() => (port === undefined ? reject(new Error("no port")) : resolve(port)));
    });
  });
}

/**
 * Poll until `url` serves a page. The dev server answers HTML only to a
 * browser-shaped Accept header (AGENTS.md); a plain fetch gets a 404.
 */
async function servesHtml(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function startVite(port: number, backend: Backend): Promise<Child> {
  const vite = start(
    "vp dev",
    ["bun", "x", "vp", "dev", "--mode", "e2e", "--port", String(port), "--strictPort"],
    // Vite ranks an existing environment variable above every `.env`
    // file, so this is what the app talks to whatever `.env.local` says.
    {
      ...process.env,
      VITE_BACKEND: "spacetimedb",
      VITE_SPACETIMEDB_HOST: backend.host,
      VITE_SPACETIMEDB_DB: backend.db,
    },
  );
  const url = `http://localhost:${port}/`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && alive(vite.process)) {
    if (await servesHtml(url)) return vite;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stop(vite);
  throw new Error(`vp dev did not serve ${url}\n--- last output ---\n${vite.tail.join("\n")}`);
}

/** Start both servers, or throw with everything already stopped. */
async function startServers(): Promise<{ baseUrl: string; teardown: () => Promise<void> }> {
  const backend = await ensureBackend();
  try {
    // Both paths above produce a local URL; this is the one place that
    // says so before anything writes through it.
    if (!isLocal(backend.host)) {
      throw new Error(`The browser gate only runs against a local backend, not ${backend.host}`);
    }
    const port = await freePort();
    const vite = await startVite(port, backend);
    return {
      baseUrl: `http://localhost:${port}`,
      teardown: async () => {
        await stop(vite);
        await backend.teardown();
      },
    };
  } catch (error) {
    await backend.teardown();
    throw error;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  await ensureChromium();
  const external = process.env.E2E_BASE_URL?.replace(/\/$/, "");
  if (external) {
    project.provide("e2eBaseUrl", external);
    return async () => {};
  }
  const { baseUrl, teardown } = await startServers();
  project.provide("e2eBaseUrl", baseUrl);
  return teardown;
}
