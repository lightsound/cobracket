/**
 * The SpacetimeDB adapter, live, at app scale, under the diagnostics gate.
 *
 * Every other src test fakes the backend seam (`src/test-fakes.ts`); this one
 * fakes nothing. It boots a real SpacetimeDB standalone with the real module
 * published, points the app at it through the environment selection PR-B
 * added (`VITE_BACKEND=spacetimedb`), and drives the real pages through the
 * adapter: create a tournament on Home, bulk-add sixteen participants,
 * generate and publish a double-elimination bracket (31 matches — the same
 * scenario size as the browser gate, because scenario size is the
 * scope-width contract), report a result through the dialog, and open the
 * Share page anonymously. The whole flow runs inside this project's test
 * bodies, so the diagnostics gate in `src/test-setup.ts` judges it with the
 * same checks and thresholds as every other test — that is the point: the
 * adapter's subscription bursts and deliveries must hold the gate the
 * Convex client holds.
 *
 * The suite boots its own server (its own port, database, and build
 * directory) so `bun run test` stays self-contained; the boot mechanics
 * deliberately mirror `spacetimedb/connection/global-setup.ts`, the same
 * self-contained pattern the spike used. The browser gate re-boots this
 * scenario against SpacetimeDB separately (M4); this suite's job is the
 * adapter under the *test* gate, where the pages already run.
 *
 * The boot happens in `beforeAll`, outside any test body: server startup is
 * fixture work, not app behavior, and the gate captures per test body.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import { mount } from "../test-setup";

const { default: App } = await import("../App");

localStorage.setItem("cobracket:locale", "en");

// ---------------------------------------------------------------------------
// The standalone driver (mirrors spacetimedb/connection/global-setup.ts).

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUILD_DIR = join(REPO_ROOT, "spacetimedb", ".live-build");
const MODULE_DIR = join(BUILD_DIR, "module");
const DATA_DIR = join(BUILD_DIR, "data");
const PORT = Number(process.env["LIVE_PORT"] ?? 3124);
const HOST = `http://127.0.0.1:${PORT}`;
const DB_NAME = "cobracket-live";
const SERVER_VERSION = "2.15.0";

let server: ChildProcess | undefined;

function log(message: string): void {
  process.stdout.write(`[live] ${message}\n`);
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function ensureBinaries(): string {
  // An explicit override is honored as given (the connection driver's
  // contract): if it does not hold the binaries, the version assert
  // below fails loudly rather than the suite silently testing a
  // different binary set than the operator specified.
  const override = process.env["SPACETIME_BIN_DIR"];
  if (override !== undefined) return override;
  const shared = join(REPO_ROOT, "spacetimedb", ".connection-build", "bin");
  if (existsSync(join(shared, "spacetime"))) return shared;
  const binDir = join(BUILD_DIR, "bin");
  if (existsSync(join(binDir, "spacetime"))) return binDir;
  return downloadBinaries(binDir);
}

function downloadBinaries(binDir: string): string {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(
      "the live suite's binary download covers linux-x64 only; set SPACETIME_BIN_DIR to a directory holding the SpacetimeDB 2.15.0 spacetime + spacetimedb-standalone binaries",
    );
  }
  mkdirSync(binDir, { recursive: true });
  const asset = "spacetime-x86_64-unknown-linux-gnu.tar.gz";
  const url = `https://github.com/clockworklabs/SpacetimeDB/releases/download/v${SERVER_VERSION}/${asset}`;
  const tarball = join(BUILD_DIR, asset);
  log(`downloading ${url}`);
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

// The suite asserts wire behavior of one exact server release; a
// stale or foreign binary in the bin dir must fail loudly rather
// than prove things about the wrong server.
function assertServerVersion(binDir: string): void {
  const out = run(join(binDir, "spacetimedb-standalone"), ["--version"]);
  if (!out.includes(SERVER_VERSION)) {
    throw new Error(
      `standalone binary reports "${out.trim()}", expected ${SERVER_VERSION} — clear spacetimedb/.live-build/bin and spacetimedb/.connection-build/bin or point SPACETIME_BIN_DIR elsewhere`,
    );
  }
}

function assembleModule(): void {
  rmSync(MODULE_DIR, { recursive: true, force: true });
  mkdirSync(MODULE_DIR, { recursive: true });
  const source = join(REPO_ROOT, "spacetimedb");
  for (const file of ["package.json", "tsconfig.json"]) {
    writeFileSync(join(MODULE_DIR, file), readFileSync(join(source, file)));
  }
  cpSync(join(source, "src"), join(MODULE_DIR, "src"), { recursive: true });
  cpSync(join(source, "format"), join(MODULE_DIR, "format"), { recursive: true });
}

function jwtKeyPaths(): { privateKey: string; publicKey: string } {
  const configDir = join(homedir(), ".config", "spacetime");
  const priv = join(configDir, "id_ecdsa");
  const pub = join(configDir, "id_ecdsa.pub");
  if (existsSync(priv) && existsSync(pub)) return { privateKey: priv, publicKey: pub };
  const keyDir = join(BUILD_DIR, "keys");
  mkdirSync(keyDir, { recursive: true });
  const generated = join(keyDir, "id_ecdsa");
  // A cached key in the rejected SEC1 form (minted by an early
  // version of this driver) is regenerated, not reused: the private
  // key must be PKCS#8, the form the CLI itself writes.
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
  return { privateKey: generated, publicKey: `${generated}.pub` };
}

function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = tcpConnect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.end();
      resolvePromise(true);
    });
    socket.once("error", () => resolvePromise(false));
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await portIsOpen(port)) return;
    if (Date.now() > deadline) throw new Error(`standalone did not start listening on ${port}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
}

async function boot(): Promise<void> {
  const binDir = ensureBinaries();
  assertServerVersion(binDir);
  assembleModule();
  // The local-target assertion: loopback host, this suite's own
  // port, free before the child starts — a foreign server already
  // listening there would silently take the publish and the proof.
  if (!HOST.startsWith("http://127.0.0.1:")) {
    throw new Error(`live suite target is not loopback: ${HOST}`);
  }
  if (await portIsOpen(PORT)) {
    throw new Error(`port ${PORT} is already in use — stop that server or set LIVE_PORT`);
  }
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const keys = jwtKeyPaths();
  server = spawn(
    join(binDir, "spacetimedb-standalone"),
    [
      "start",
      "--data-dir",
      DATA_DIR,
      "--jwt-priv-key-path",
      keys.privateKey,
      "--jwt-pub-key-path",
      keys.publicKey,
      "--listen-addr",
      `127.0.0.1:${PORT}`,
      "--non-interactive",
    ],
    { detached: true, stdio: "ignore" },
  );
  server.unref();
  try {
    await waitForPort(PORT, 60_000);
    run(join(binDir, "spacetime"), [
      "publish",
      "--server",
      HOST,
      "--module-path",
      MODULE_DIR,
      DB_NAME,
    ]);
  } catch (error) {
    // The child is detached: a failed boot must not leave it running
    // behind the suite's back.
    await shutdown();
    throw error;
  }
  log(`standalone on ${HOST}, module published as ${DB_NAME}`);
}

async function shutdown(): Promise<void> {
  if (server?.pid === undefined) return;
  const pid = server.pid;
  server = undefined;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
  // Escalate only if the group ignores SIGTERM: a leaked standalone
  // would hold the port and poison the next run.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  try {
    process.kill(-pid, 0);
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is gone — the expected path.
  }
}

// ---------------------------------------------------------------------------
// Driving the pages.

const NAMES = [
  "Alpha",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Golf",
  "Hotel",
  "India",
  "Juliett",
  "Kilo",
  "Lima",
  "Mike",
  "November",
  "Oscar",
  "Papa",
];

/** Poll a DOM condition until it holds; the gate counts nothing here — the
 * waits are the test's own synchronization with a real network backend. */
async function waitFor(what: string, probe: () => boolean, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    flush();
    if (probe()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
}

function field(host: HTMLElement, label: string): HTMLInputElement {
  const wrapper = [...host.querySelectorAll("label")].find((node) =>
    (node.textContent ?? "").includes(label),
  );
  const input = wrapper?.querySelector("input");
  if (!input) throw new Error(`no input under label ${label}`);
  return input;
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
}

function buttonByText(host: ParentNode, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find(
    (node) => (node.textContent ?? "").trim() === text,
  );
  if (!button) throw new Error(`no button labelled ${text}`);
  return button;
}

function occurrences(host: HTMLElement, needle: string): number {
  return (host.querySelector("main")?.textContent ?? "").split(needle).length - 1;
}

beforeAll(async () => {
  await boot();
  vi.stubEnv("VITE_BACKEND", "spacetimedb");
  vi.stubEnv("VITE_SPACETIMEDB_HOST", HOST);
  vi.stubEnv("VITE_SPACETIMEDB_DB", DB_NAME);
}, 240_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await shutdown();
});

test("runs a sixteen-player double elimination live through the adapter", async () => {
  const host = mount(() => <App />);

  // Home: the create form, through the real auth bind and create write.
  await waitFor("the create form", () => host.querySelector("form") !== null);
  type(field(host, "Tournament name"), "Live Cup");
  type(field(host, "Discipline"), "Chess");
  const doubleRadio = [...host.querySelectorAll<HTMLInputElement>("input[type=radio]")].find(
    (radio) => radio.closest("label")?.textContent?.includes("Double elimination"),
  );
  doubleRadio?.click();
  flush();
  host
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  // The organizer page for the new tournament, roster empty.
  await waitFor("the roster editor", () => host.querySelector("textarea") !== null);
  expect(host.querySelector("main")?.textContent).toContain("Live Cup");

  // Bulk-add the sixteen participants in one write.
  const bulk = host.querySelector<HTMLTextAreaElement>("textarea");
  if (!bulk) throw new Error("no bulk textarea");
  type(bulk, NAMES.join("\n"));
  buttonByText(host, "Add all").click();
  await waitFor("sixteen roster rows", () => NAMES.every((name) => occurrences(host, name) >= 1));

  // Generate: the bracket composition derives all 31 matches client-side.
  buttonByText(host, "Generate Bracket").click();
  await waitFor(
    "31 match cards",
    () => host.querySelectorAll("button[style*='--card-x']").length === 31,
  );

  // Publish, then report the first ready match through its dialog.
  // The Share link's intent fires ahead of the report step: a real
  // click is preceded by link intent (hover/focus), which is what
  // starts the route's data (AGENTS.md: prefetch on intent) — a bare
  // synthetic click would cold-navigate and hold the router on the
  // first shared delivery, which is not the behavior being proven
  // here. Firing it here gives the prefetch the whole report step's
  // round trips to land in.
  const shareAnchor = () =>
    [...host.querySelectorAll("a")].find((a) => (a.getAttribute("href") ?? "").startsWith("/s/"));
  buttonByText(host, "Publish").click();
  // The share anchor is always in the header; the status badge is what
  // proves the publish landed.
  await waitFor("the published status", () =>
    (host.querySelector("main")?.textContent ?? "").includes("Published"),
  );
  shareAnchor()?.dispatchEvent(new Event("focusin", { bubbles: true }));
  const card = [...host.querySelectorAll<HTMLButtonElement>("button[style*='--card-x']")].find(
    (candidate) => !candidate.disabled,
  );
  if (!card) throw new Error("no reportable match card");
  card.click();
  await waitFor("the report dialog", () => document.body.querySelector("form.max-w-sm") !== null);
  const dialog = document.body.querySelector("form.max-w-sm");
  const radios = [...(dialog?.querySelectorAll<HTMLInputElement>("input[type=radio]") ?? [])];
  const winnerLabel = radios[0]?.closest("label")?.textContent ?? "";
  const winner = NAMES.find((name) => winnerLabel.includes(name));
  if (winner === undefined) throw new Error(`no participant named in the dialog: ${winnerLabel}`);
  const before = occurrences(host, winner);
  radios[0]?.click();
  flush();
  dialog?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await waitFor("the dialog to close", () => document.body.querySelector("form.max-w-sm") === null);
  // The winner advances: their name now also occupies the next-round card.
  await waitFor("the winner to advance", () => occurrences(host, winner) > before);

  // The Share page renders the same bracket for an anonymous viewer.
  shareAnchor()?.click();
  await waitFor(
    "31 shared match cards",
    () => host.querySelectorAll("button[style*='--card-x']").length === 31,
  );
  expect(host.querySelector("main")?.textContent).toContain("Live Cup");
}, 120_000);

test("surfaces the module's refusal text when a write is refused", async () => {
  const host = mount(() => <App />);
  // The previous test ended on the Share route, and the router reads
  // the location at creation: go home through the shell's own link.
  await waitFor("the shell", () => host.querySelector("header a") !== null);
  host.querySelector<HTMLAnchorElement>("header a")?.click();
  await waitFor("the create form", () => host.querySelector("form") !== null);
  type(field(host, "Tournament name"), "Refused Cup");
  type(field(host, "Discipline"), "   ");
  host
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  // The module's guard refuses with a SenderError carrying this text,
  // and the adapter surfaces it as the write's failure — the failure
  // contract Convex's error texts used to provide, now carried by the
  // module itself across the wire.
  await waitFor("the refusal text", () =>
    (host.querySelector("main")?.textContent ?? "").includes("Discipline must not be empty"),
  );
  expect(host.querySelector("main h2")?.textContent).toBe("Your tournaments");
}, 60_000);
