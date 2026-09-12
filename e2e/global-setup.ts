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
 * 2. `.env.local` names a local deployment that answers — the long-running
 *    `convex:dev` from AGENTS.md's workflow — so only the dev server starts.
 * 3. Neither (CI, a fresh container) — `convex dev` starts too, on the
 *    anonymous deployment, and the auth keys ADR 0003 requires are generated
 *    when the first push reports them missing. That is the same sequence a
 *    human runs, automated: `auth:keys` is idempotent, and the CLI re-pushes
 *    on its own once the keys exist (observed, not assumed; the wait below
 *    is bounded in case that ever stops being true).
 *
 * Children run in their own process group and the group is what gets killed:
 * `convex dev` spawns the backend binary as a grandchild, and killing the CLI
 * alone leaves a backend on :3210 for the next run to trip over.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vite-plus/test/node";

declare module "vitest" {
  interface ProvidedContext {
    e2eBaseUrl: string;
  }
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
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

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

async function stop(child: Child): Promise<void> {
  if (!alive(child.process)) return;
  const { pid } = child.process;
  const exited = new Promise<void>((resolve) => child.process.once("exit", () => resolve()));
  signalGroup(pid, "SIGTERM");
  const grace = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5000));
  if ((await Promise.race([exited, grace])) === "timeout") signalGroup(pid, "SIGKILL");
  await exited;
}

async function stopAll(children: Child[]): Promise<void> {
  for (const child of [...children].reverse()) await stop(child);
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

/** `VITE_CONVEX_URL` from `.env.local`, if the file exists and names one. */
async function configuredConvexUrl(): Promise<string | undefined> {
  let env: string;
  try {
    env = await readFile(new URL(".env.local", `file://${ROOT}`), "utf8");
  } catch {
    return undefined;
  }
  return /^VITE_CONVEX_URL=(.+)$/m.exec(env)?.[1]?.trim();
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

/**
 * Make sure a local deployment is up and its functions are pushed. Returns
 * the child to stop afterwards, or nothing when an existing one is reused.
 */
async function ensureConvex(): Promise<Child | undefined> {
  if ((await runningConvexUrl()) !== undefined) return undefined;
  const convex = start("convex dev", ["bun", "run", "convex:dev"], ANONYMOUS);
  try {
    await awaitPushed(convex);
    return convex;
  } catch (error) {
    // The caller only learns of the child on success, so a wait that gives
    // up has to take the process group down here — otherwise the backend
    // stays on its port and the next run reuses it half-configured.
    await stop(convex);
    throw error;
  }
}

/** Wait for the first push to land, generating the auth keys if it needs them. */
async function awaitPushed(convex: Child): Promise<void> {
  const ready = /Convex functions ready/;
  await convex.waitFor(/Convex functions ready|MissingEnvironmentVariables/, 180_000);
  if (convex.tail.some((line) => ready.test(line))) return;
  generateAuthKeys();
  await convex.waitFor(ready, 90_000);
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

async function startVite(port: number): Promise<Child> {
  const vite = start(
    "vp dev",
    ["bun", "x", "vp", "dev", "--mode", "e2e", "--port", String(port), "--strictPort"],
    process.env,
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
async function startServers(): Promise<{ baseUrl: string; children: Child[] }> {
  const children: Child[] = [];
  try {
    const convex = await ensureConvex();
    if (convex) children.push(convex);
    const port = await freePort();
    children.push(await startVite(port));
    return { baseUrl: `http://localhost:${port}`, children };
  } catch (error) {
    await stopAll(children);
    throw error;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const external = process.env.E2E_BASE_URL?.replace(/\/$/, "");
  if (external) {
    project.provide("e2eBaseUrl", external);
    return async () => {};
  }
  const { baseUrl, children } = await startServers();
  project.provide("e2eBaseUrl", baseUrl);
  return () => stopAll(children);
}
