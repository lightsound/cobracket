// fallow-ignore-file code-duplication -- the standalone driver mechanics are shared with the connection suite (spacetimedb/connection/global-setup.ts) and the live suite (src/lib/spacetimedb.live.test.tsx) by deliberate mirror: each driver stays self-contained rather than coupling CI-gated suites to one another; the connection suite's driver carries the same suppression for the same reason
/**
 * The browser gate's global setup: boots the standalone, the module and
 * the dev server the scenario drives. Boot model, safety invariants and
 * mechanics: docs/diagnostics-gates.md (Global-setup boot model).
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
/** Gate-only database, never an environment input — docs/diagnostics-gates.md, Global-setup boot model. */
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
  tail: string[];
}

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

async function settles(done: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (done()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return done();
}

async function stop(child: Child): Promise<void> {
  const { pid } = child.process;
  if (pid === undefined || !groupAlive(pid)) return;
  signalGroup(pid, "SIGTERM");
  if (await settles(() => !groupAlive(pid), 5000)) return;
  signalGroup(pid, "SIGKILL");
  await settles(() => !groupAlive(pid), 5000);
}

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

function readEnvLocal(): string | undefined {
  try {
    return readFileSync(ENV_LOCAL, "utf8");
  } catch {
    return undefined;
  }
}

function envLocalValue(name: string): string | undefined {
  const env = readEnvLocal();
  if (env === undefined) return undefined;
  const pattern = new RegExp(`^${name}=(.+)$`, "m");
  return pattern.exec(env)?.[1]?.trim();
}

function isLocal(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

function run(command: string, args: string[], cwd?: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function ensureBinaries(): string {
  const override = process.env.SPACETIME_BIN_DIR;
  if (override !== undefined) return override;
  const shared = join(SPACETIMEDB_DIR, ".connection-build", "bin");
  if (existsSync(join(shared, "spacetime"))) return shared;
  const binDir = join(BUILD_DIR, "bin");
  if (existsSync(join(binDir, "spacetime"))) return binDir;
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
  cpSync(join(SPACETIMEDB_DIR, "lifecycle"), join(MODULE_DIR, "lifecycle"), { recursive: true });
}

function jwtKeyPaths(): { pub: string; priv: string } {
  return cliKeyPaths() ?? generatedKeyPaths();
}

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
  // The public half is re-derived either way: docs/diagnostics-gates.md, Global-setup boot model.
  else derivePublicKey(generated);
  return { pub: `${generated}.pub`, priv: generated };
}

/** A cached key in the rejected SEC1 form is regenerated, not reused — docs/diagnostics-gates.md, Global-setup boot model. */
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

function publishModule(binDir: string, host: string, db: string): void {
  run(join(binDir, "spacetime"), ["publish", "--server", host, "--module-path", MODULE_DIR, db]);
}

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

/** Browser-shell install and fallback store: AGENTS.md (Browser gate); the preinstalled-build measurement: docs/diagnostics-gates.md, Evidence log. */
async function ensureChromium(): Promise<void> {
  if (await chromiumLaunches()) return;
  const store = process.env.PLAYWRIGHT_BROWSERS_PATH === undefined ? undefined : BROWSER_CACHE;
  installHeadlessShell(store);
  if (store !== undefined) process.env.PLAYWRIGHT_BROWSERS_PATH = store;
}

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

interface Backend {
  host: string;
  db: string;
  teardown: () => Promise<void>;
}

function envLocalBackend(): { host: string; db: string } | undefined {
  if (envLocalValue("VITE_BACKEND") !== "spacetimedb") return undefined;
  const host = envLocalValue("VITE_SPACETIMEDB_HOST");
  const db = envLocalValue("VITE_SPACETIMEDB_DB");
  if (host === undefined || db === undefined) return undefined;
  return { host, db };
}

/** Mode-2 reuse conditions and republishing the current module: docs/diagnostics-gates.md, Global-setup boot model. */
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

function assertUsablePort(): void {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error(`E2E_SPACETIME_PORT is not a usable port: ${process.env.E2E_SPACETIME_PORT}`);
  }
}

/** Local-target assertion (loopback host, own port asserted free, explicit --server): docs/diagnostics-gates.md, Global-setup boot model. */
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

async function startServers(): Promise<{ baseUrl: string; teardown: () => Promise<void> }> {
  const backend = await ensureBackend();
  try {
    // Local-target assertion before any write: docs/diagnostics-gates.md, Global-setup boot model (Safety invariants).
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
