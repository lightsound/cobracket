/**
 * What the browser gate drives, brought up once per run: the anonymous local
 * Convex deployment and the app's dev server in `--mode e2e`.
 *
 * Nothing here is faked. The gate exists because the happy-dom one, which
 * replaces the data seam (`src/test-fakes.ts`), let a real-browser finding
 * through — so this one keeps the seam real: the page signs in anonymously,
 * subscribes over the websocket and runs the same mutations an Organizer
 * does. Auth, subscriptions and the bracket are all under the capture.
 *
 * Three ways in, in order of preference:
 *
 * 1. `E2E_BASE_URL` set — the caller runs the app (their own `convex:dev` and
 *    a `bun dev --mode e2e`); nothing is started or stopped here.
 * 2. `.env.local` names a *local* deployment that answers — the long-running
 *    `convex:dev` from AGENTS.md's workflow — so only the dev server starts.
 * 3. Neither (CI, a fresh container, a developer whose `.env.local` names a
 *    cloud deployment) — `convex dev` starts too, on the anonymous local
 *    deployment, and the auth keys ADR 0003 requires are generated when the
 *    first push reports them missing. That is the same sequence a human
 *    runs, automated: `auth:keys` is idempotent, and the CLI re-pushes on
 *    its own once the keys exist (observed, not assumed; the wait below is
 *    bounded in case that ever stops being true).
 *
 * The gate never writes to a deployment it did not choose. Its own
 * `convex dev` runs with `--env-file` pointing at a private file that names
 * the anonymous deployment, so the CLI takes its target from there and not
 * from `.env.local`, and the dev server gets `VITE_CONVEX_URL` in its
 * environment, which Vite ranks above any `.env` file — so a cloud URL a
 * logged-in `convex dev` left in `.env.local` reaches neither the CLI nor
 * the app. What the app is pointed at is asserted local before it starts.
 * One side effect remains and is undone: the anonymous CLI still *writes*
 * `.env.local` for the deployment it ran (measured — `--env-file` changes
 * what it reads, not what it saves), so the file is snapshotted before the
 * CLI starts and put back on teardown; a `.env.local` that did not exist is
 * removed again. A developer's own deployment settings survive the run.
 *
 * Children run in their own process group and the group is what gets killed:
 * `convex dev` spawns the backend binary as a grandchild, and killing the CLI
 * alone leaves a backend on :3210 for the next run to trip over.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vite-plus/test/node";

declare module "vitest" {
  interface ProvidedContext {
    e2eBaseUrl: string;
  }
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV_LOCAL = join(ROOT, ".env.local");
const ANONYMOUS = { ...process.env, CONVEX_AGENT_MODE: "anonymous" };

interface Child {
  label: string;
  process: ChildProcess;
  /** The last lines of output, for the failure message. */
  tail: string[];
  /** Resolves when a line matching `pattern` arrives, past or future. */
  waitFor(pattern: RegExp, timeoutMs: number): Promise<void>;
}

function start(label: string, command: string[], env: NodeJS.ProcessEnv): Child {
  const child = spawn(command[0]!, command.slice(1), {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const lines: string[] = [];
  const waiters: { pattern: RegExp; resolve: () => void }[] = [];
  let exit: string | undefined;

  const onLine = (line: string) => {
    lines.push(line);
    for (const waiter of waiters.splice(0)) {
      if (waiter.pattern.test(line)) waiter.resolve();
      else waiters.push(waiter);
    }
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
    exit = `exited (${code ?? signal})`;
    onLine(exit);
  });

  return {
    label,
    process: child,
    get tail() {
      return lines.slice(-30);
    },
    waitFor(pattern, timeoutMs) {
      return new Promise<void>((resolve, reject) => {
        const waiter = { pattern, resolve: () => {} };
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(
            new Error(
              `${label}: no line matched ${pattern} within ${timeoutMs}ms` +
                (exit ? ` (${exit})` : "") +
                `\n--- last output ---\n${lines.slice(-30).join("\n")}`,
            ),
          );
        }, timeoutMs);
        waiter.resolve = () => {
          clearTimeout(timer);
          resolve();
        };
        if (lines.some((line) => pattern.test(line))) waiter.resolve();
        else waiters.push(waiter);
      });
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
 * every member, not just the leader. `convex dev` is a `bun run` leader, the
 * CLI, and the backend binary; the leader exits on SIGTERM at once, and a
 * teardown that only waited for it left a backend behind on :3210 (measured
 * once, on a run that otherwise passed). So the wait is on the group, and a
 * group that outlives the grace period is killed outright.
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

/** `.env.local` as it is, or nothing when there is no such file. */
async function readEnvLocal(): Promise<string | undefined> {
  try {
    return await readFile(ENV_LOCAL, "utf8");
  } catch {
    return undefined;
  }
}

/** `VITE_CONVEX_URL` from `.env.local`, if the file exists and names one. */
async function configuredConvexUrl(): Promise<string | undefined> {
  const env = await readEnvLocal();
  return env === undefined ? undefined : /^VITE_CONVEX_URL=(.+)$/m.exec(env)?.[1]?.trim();
}

/**
 * Put `.env.local` back the way it was before the gate's own CLI ran: the
 * anonymous CLI saves its deployment there whatever `--env-file` said.
 */
async function restoreEnvLocal(before: string | undefined): Promise<void> {
  if (before === undefined) await rm(ENV_LOCAL, { force: true });
  else await writeFile(ENV_LOCAL, before);
}

/** The local deployment `.env.local` names, if one is up — the long-running `convex:dev`. */
async function runningConvexUrl(): Promise<string | undefined> {
  const url = await configuredConvexUrl();
  if (url === undefined || !isLocal(url)) return undefined;
  return (await listening(url)) ? url : undefined;
}

/**
 * Reuse only a local deployment: a logged-in `convex dev` puts a cloud URL
 * in `.env.local`, and the gate writes real tournaments through whatever it
 * reaches.
 */
function isLocal(url: string): boolean {
  const { hostname } = new URL(url);
  return hostname === "127.0.0.1" || hostname === "localhost";
}

/** ADR 0003: a deployment without its RS256 keys refuses every push. */
function generateAuthKeys(): void {
  const keys = spawnSync("bun", ["run", "auth:keys"], {
    cwd: ROOT,
    env: ANONYMOUS,
    encoding: "utf8",
  });
  if (keys.status !== 0) {
    throw new Error(`auth:keys failed (${keys.status}):\n${keys.stdout}\n${keys.stderr}`);
  }
}

/** What the gate brought up, or reused, and how to take it down. */
interface Convex {
  url: string;
  teardown: () => Promise<void>;
}

/**
 * Make sure a local deployment is up and its functions are pushed, and say
 * where it is.
 */
async function ensureConvex(): Promise<Convex> {
  const running = await runningConvexUrl();
  if (running !== undefined) return { url: running, teardown: async () => {} };

  // A private env file names the deployment, so the CLI's target does not
  // come from `.env.local` — which it still saves to, hence the snapshot.
  const envLocalBefore = await readEnvLocal();
  const dir = await mkdtemp(join(tmpdir(), "cobracket-e2e-"));
  const envFile = join(dir, "convex.env");
  await writeFile(envFile, "CONVEX_DEPLOYMENT=anonymous:anonymous-agent\n");
  const convex = start(
    "convex dev",
    ["bun", "run", "convex:dev", "--env-file", envFile],
    ANONYMOUS,
  );
  const teardown = async () => {
    await stop(convex);
    await rm(dir, { recursive: true, force: true });
    await restoreEnvLocal(envLocalBefore);
  };
  try {
    return { url: await awaitPushed(convex), teardown };
  } catch (error) {
    // The caller only learns of the child on success, so a wait that gives
    // up has to take the process group down here — otherwise the backend
    // stays on its port and the next run reuses it half-configured.
    await teardown();
    throw error;
  }
}

/**
 * Wait for the first push to land, generating the auth keys if it needs
 * them, and return the deployment URL the CLI announced.
 */
async function awaitPushed(convex: Child): Promise<string> {
  const ready = /Convex functions ready/;
  await convex.waitFor(/Convex functions ready|MissingEnvironmentVariables/, 180_000);
  if (!convex.tail.some((line) => ready.test(line))) {
    generateAuthKeys();
    await convex.waitFor(ready, 90_000);
  }
  return announcedUrl(convex);
}

/** The `└─ http://127.0.0.1:3210` line of the CLI's deployment banner. */
function announcedUrl(convex: Child): string {
  for (const line of convex.tail) {
    const match = /└─\s+(https?:\/\/\S+)/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  throw new Error(
    `convex dev did not announce a deployment URL\n--- last output ---\n${convex.tail.join("\n")}`,
  );
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

async function startVite(port: number, convexUrl: string): Promise<Child> {
  const vite = start(
    "vp dev",
    ["bun", "x", "vp", "dev", "--mode", "e2e", "--port", String(port), "--strictPort"],
    // Vite ranks an existing environment variable above every `.env` file,
    // so this is what the app talks to whatever `.env.local` says.
    { ...process.env, VITE_CONVEX_URL: convexUrl },
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
  const convex = await ensureConvex();
  try {
    // Both paths above produce a local URL; this is the one place that
    // says so before anything writes through it.
    if (!isLocal(convex.url)) {
      throw new Error(`The browser gate only runs against a local deployment, not ${convex.url}`);
    }
    const port = await freePort();
    const vite = await startVite(port, convex.url);
    return {
      baseUrl: `http://localhost:${port}`,
      teardown: async () => {
        await stop(vite);
        await convex.teardown();
      },
    };
  } catch (error) {
    await convex.teardown();
    throw error;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const external = process.env.E2E_BASE_URL?.replace(/\/$/, "");
  if (external) {
    project.provide("e2eBaseUrl", external);
    return async () => {};
  }
  const { baseUrl, teardown } = await startServers();
  project.provide("e2eBaseUrl", baseUrl);
  return teardown;
}
