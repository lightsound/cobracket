/// <reference types="bun" />
// fallow-ignore-file coverage-gaps -- driven as a subprocess by `bun run spacetime:spike`; its PASS/FAIL verdict is its test, and a subprocess is not an import edge (see .fallowrc.jsonc)
// Wire-level verification spike for the SpacetimeDB read surfaces
// (migration slice M1; plan §5 Q2). The module harness
// (spacetimedb/test/) proves view *logic* in-process; it cannot prove
// what only a real connection can: that a private base table rejects
// a subscription, that a slug-argument view delivers exactly the
// gated rows to an anonymous connection, that a sender-gated view
// answers per caller, and that view subscriptions deliver live
// updates. This script proves those against a throwaway standalone:
//
//   1. assembles a module from the committed sources in ../src plus
//      the fixture reducers in ./fixture (seed data + a mutation),
//   2. downloads the pinned SpacetimeDB 2.15.0 server binaries (or
//      reuses SPACETIME_BIN_DIR), starts a standalone on a scratch
//      port with a fresh data dir under ./.spike-build (gitignored),
//   3. publishes, generates client bindings, and probes over real
//      websocket connections with two identities,
//   4. prints a JSON verdict and exits non-zero on any failure.
//
// It also composes the shared tournament client-side from the shared
// views + the relocated format engine (../format) — surface (b)'s
// shape at wire level, over the anonymous surface. Run it with:
//
//   bun run spacetime:spike
//
// Nothing here touches Maincloud or any named deployment: the server
// is a local child process and dies with the run.

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deriveProgression } from "../format";
import type { BracketStructure, RecordedResult } from "../format";

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = join(SPIKE_DIR, "..");
const BUILD_DIR = join(MODULE_DIR, ".spike-build");
const PORT = Number(process.env.SPIKE_PORT ?? 3111);
const HOST = `http://127.0.0.1:${PORT}`;
const DB_NAME = "cobracket-spike";
const SERVER_VERSION = "2.15.0";

interface Check {
  name: string;
  pass: boolean;
  evidence: string;
}
const checks: Check[] = [];
function record(name: string, pass: boolean, evidence: string) {
  checks.push({ name, pass, evidence });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${evidence}`);
}

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
      "the spike's binary download covers linux-x64 only; set SPACETIME_BIN_DIR to a directory holding the SpacetimeDB 2.15.0 spacetime + spacetimedb-standalone binaries",
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

// --- module assembly --------------------------------------------------------

function assembleModule(): string {
  const dir = join(BUILD_DIR, "module");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  cpSync(join(MODULE_DIR, "package.json"), join(dir, "package.json"));
  cpSync(join(MODULE_DIR, "tsconfig.json"), join(dir, "tsconfig.json"));
  cpSync(join(MODULE_DIR, "src"), join(dir, "src"), { recursive: true });
  // The format engine joins the assembly too (M2): the module's
  // library imports it from src/lib as ../../format, so the assembled
  // layout must keep it beside src/, exactly as in the repo.
  cpSync(join(MODULE_DIR, "format"), join(dir, "format"), { recursive: true });
  // The fixture seed joins the module only here: copied in with its
  // one import rewritten to the assembled layout, and the entry gains
  // its re-export.
  const seed = readFileSync(join(SPIKE_DIR, "fixture", "seed.ts"), "utf8");
  const marker = 'from "../../src/schema"';
  if (!seed.includes(marker)) {
    throw new Error("fixture seed import marker not found — seed.ts drifted");
  }
  writeFileSync(join(dir, "src", "seed.ts"), seed.replace(marker, 'from "./schema"'));
  writeFileSync(
    join(dir, "src", "index.ts"),
    [
      'import { spacetimedb } from "./schema";',
      "",
      "export default spacetimedb;",
      // Every registration file, as the real entry exports them — so
      // publishing the assembled module also proves the host accepts
      // each registration (M2 added the reducers and the scanning
      // suggestion view to M1's read surfaces) — plus the fixture
      // seed, which only exists in this assembly.
      'export * from "./auth";',
      'export * from "./bracket";',
      'export * from "./disciplines";',
      'export * from "./roster";',
      'export * from "./share";',
      'export * from "./tournaments";',
      'export * from "./seed";',
      "",
    ].join("\n"),
  );
  return dir;
}

// --- server lifecycle -------------------------------------------------------

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
  // is rejected with InvalidKeyFormat (measured 2026-11-15 on a
  // fresh-HOME run, the connection suite's CI case).
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
  // The port must be free before the child starts: a foreign server
  // already listening there would silently take the publish and the
  // probes, and the spike would prove things about the wrong server.
  if (await portIsOpen(PORT)) {
    throw new Error(`port ${PORT} is already in use — stop that server or set SPIKE_PORT`);
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
    // running behind the spike's back.
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
  // Escalate if the group ignores SIGTERM: a leaked standalone
  // would hold the port and poison the next run.
  await sleep(500);
  try {
    process.kill(-pid, 0);
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is gone — the expected path.
  }
}

function publishAndGenerate(spacetime: string, moduleDir: string): string {
  run(spacetime, ["publish", "--server", HOST, "--module-path", moduleDir, DB_NAME]);
  const bindingsDir = join(BUILD_DIR, "bindings");
  rmSync(bindingsDir, { recursive: true, force: true });
  run(spacetime, [
    "generate",
    "--lang",
    "typescript",
    "--out-dir",
    bindingsDir,
    "--module-path",
    moduleDir,
  ]);
  return bindingsDir;
}

// --- the probe ----------------------------------------------------------------

// The generated bindings are runtime values assembled by this
// script; their surface used here is declared structurally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

interface SpikeSubscriptionBuilder {
  onApplied(cb: () => void): SpikeSubscriptionBuilder;
  onError(cb: (ctx: AnyRow, err: AnyRow) => void): SpikeSubscriptionBuilder;
  subscribe(queries: string[]): unknown;
}

interface SpikeConnection {
  identity: { toHexString(): string };
  reducers: {
    spikeSeed(): Promise<void>;
    spikeBind(): Promise<void>;
    spikeMutate(): Promise<void>;
  };
  db: Record<
    string,
    {
      iter(): Iterable<AnyRow>;
      onInsert(cb: (ctx: AnyRow, row: AnyRow) => void): void;
      onDelete(cb: (ctx: AnyRow, row: AnyRow) => void): void;
      onUpdate(cb: (ctx: AnyRow, old: AnyRow, row: AnyRow) => void): void;
    }
  >;
  subscriptionBuilder(): SpikeSubscriptionBuilder;
}

// The probes assert wire behavior of one exact server release; a
// stale or foreign binary in the bin dir must fail loudly rather
// than prove things about the wrong server. The standalone reports
// the version; the CLI's own `version` subcommand delegates to the
// installer shim and cannot answer for a tarball-extracted binary.
function assertServerVersion(binDir: string): void {
  const out = run(join(binDir, "spacetimedb-standalone"), ["--version"]);
  if (!out.includes(SERVER_VERSION)) {
    throw new Error(
      `standalone binary reports "${out.trim()}", expected ${SERVER_VERSION} — clear spacetimedb/.spike-build/bin or point SPACETIME_BIN_DIR elsewhere`,
    );
  }
}

async function main(): Promise<void> {
  const binDir = ensureBinaries();
  assertServerVersion(binDir);
  const moduleDir = assembleModule();
  const server = await startServer(join(binDir, "spacetimedb-standalone"));
  try {
    const bindingsDir = publishAndGenerate(join(binDir, "spacetime"), moduleDir);
    const bindings = (await import(pathToFileURL(join(bindingsDir, "index.ts")).href)) as {
      DbConnection: AnyRow;
    };
    await probe(bindings.DbConnection);
  } finally {
    await stopServer(server);
  }

  const failed = checks.filter((check) => !check.pass);
  console.log(JSON.stringify({ checks, failed: failed.length }, null, 2));
  if (failed.length > 0) {
    process.exit(1);
  }
}

function connect(DbConnection: AnyRow, token?: string): Promise<SpikeConnection> {
  return new Promise((resolve, reject) => {
    const builder = DbConnection.builder()
      .withUri(`ws://127.0.0.1:${PORT}`)
      .withDatabaseName(DB_NAME)
      .onConnect((conn: SpikeConnection) => resolve(conn))
      .onConnectError((_ctx: AnyRow, err: AnyRow) => reject(err));
    if (token) {
      builder.withToken(token);
    }
    builder.build();
  });
}

function subscribe(conn: SpikeConnection, queries: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((_ctx: AnyRow, err: AnyRow) => reject(err))
      .subscribe(queries);
  });
}

// Client bindings PascalCase every sum variant; module-side code uses
// the declared keys. The mapping the M3 adapter will own, spelled out
// here because composition needs engine-shaped values.
const SECTION_BY_TAG: Record<string, BracketStructure["matches"][number]["bracket"]> = {
  Winners: "winners",
  Losers: "losers",
  GrandFinal: "grand_final",
};

function slotToEngine(slot: AnyRow): BracketStructure["matches"][number]["slots"][number] {
  switch (slot.tag) {
    case "Participant":
      return { kind: "participant", participantId: String(slot.value.participantId) };
    case "Bye":
      return { kind: "bye" };
    case "WinnerOf":
      return { kind: "winnerOf", matchKey: slot.value.matchKey };
    case "LoserOf":
      return { kind: "loserOf", matchKey: slot.value.matchKey };
    default:
      throw new Error(`unknown slot tag ${String(slot.tag)}`);
  }
}

function sideToEngine(side: AnyRow): RecordedResult["sides"][number] {
  return {
    participantId: String(side.participantId),
    outcome: (
      side.outcome.tag as string
    ).toLowerCase() as RecordedResult["sides"][number]["outcome"],
    ...(side.score !== undefined && { score: side.score }),
  };
}

// Composes the shared tournament from the connection's cached view
// rows + the relocated engine — the client-side assembly ADR 0031
// prescribes for the flat view surfaces.
function composeShared(conn: SpikeConnection) {
  const header = [...conn.db.sharedTournament.iter()][0];
  const matches = [...conn.db.sharedMatches.iter()];
  const results = [...conn.db.sharedResults.iter()];
  const structure: BracketStructure = {
    format:
      header.format.tag === "SingleElimination"
        ? { family: "single_elimination" }
        : { family: "double_elimination", grandFinalReset: header.format.value.grandFinalReset },
    matches: matches.map((row) => ({
      key: row.key,
      bracket: SECTION_BY_TAG[row.bracket.tag]!,
      round: row.round,
      indexInRound: row.indexInRound,
      slots: [slotToEngine(row.slots[0]), slotToEngine(row.slots[1])],
    })),
  };
  const recorded: RecordedResult[] = [...results]
    .sort((a, b) => (a.seq < b.seq ? -1 : 1))
    .map((row) => ({
      matchKey: row.matchKey,
      sides: [sideToEngine(row.sides[0]), sideToEngine(row.sides[1])],
    }));
  return deriveProgression(structure, recorded);
}

async function probe(DbConnection: AnyRow): Promise<void> {
  const conn = await connect(DbConnection);
  await conn.reducers.spikeSeed();
  await sleep(300);
  await checkPrivateTable(conn);
  const viewEvents = await checkSharedSurface(conn);
  await checkSenderGating(conn, DbConnection);
  checkComposition(conn);
  await checkLiveUpdates(conn, viewEvents);
}

// (1) A private base table is truly unsubscribable: the server
// rejects the subscription rather than serving an empty set.
async function checkPrivateTable(conn: SpikeConnection): Promise<void> {
  const events = await new Promise<string[]>((resolve) => {
    const seen: string[] = [];
    conn
      .subscriptionBuilder()
      .onApplied(() => seen.push("applied"))
      .onError((_ctx: AnyRow, err: AnyRow) => {
        seen.push(`error: ${String(err?.message ?? err)}`);
        resolve(seen);
      })
      .subscribe(["SELECT * FROM participant"]);
    setTimeout(() => resolve([...seen, "(no error within 3s)"]), 3000);
  });
  record(
    "private-table-unsubscribable",
    events.some((event) => event.startsWith("error:")),
    events.join(" | "),
  );
}

// (2) The shared slug surface: the published tournament resolves,
// the draft slug and an unknown slug resolve to nothing; the rows
// carry the shared audience's fields only.
async function checkSharedSurface(conn: SpikeConnection): Promise<string[]> {
  const viewEvents: string[] = [];
  conn.db.sharedTournament.onInsert((_ctx: AnyRow, row: AnyRow) =>
    viewEvents.push(`shared_tournament insert name=${row.name}`),
  );
  conn.db.sharedTournament.onDelete((_ctx: AnyRow, row: AnyRow) =>
    viewEvents.push(`shared_tournament delete name=${row.name}`),
  );
  conn.db.sharedTournament.onUpdate((_ctx: AnyRow, _old: AnyRow, row: AnyRow) =>
    viewEvents.push(`shared_tournament UPDATE name=${row.name}`),
  );
  conn.db.sharedResults.onInsert((_ctx: AnyRow, row: AnyRow) =>
    viewEvents.push(`shared_results insert keys=${Object.keys(row).sort().join(",")}`),
  );
  await subscribe(conn, [
    "SELECT * FROM shared_tournament('abc123slug')",
    "SELECT * FROM shared_participants('abc123slug')",
    "SELECT * FROM shared_matches('abc123slug')",
    "SELECT * FROM shared_results('abc123slug')",
    "SELECT * FROM shared_tournament('draftslug999')",
    "SELECT * FROM shared_tournament('privateslug')",
    "SELECT * FROM shared_participants('privateslug')",
    "SELECT * FROM shared_tournament('nosuchslug')",
  ]);
  await sleep(300);
  const sharedTournament = [...conn.db.sharedTournament.iter()];
  record(
    "shared-slug-surface",
    sharedTournament.length === 1 &&
      sharedTournament[0].name === "Cup" &&
      sharedTournament[0].status.tag === "Published",
    `rows=${sharedTournament.map((row) => `${row.name}/${row.status.tag}`).join(",")} (draft + private + unknown slugs contributed none)`,
  );
  record(
    "private-visibility-gate",
    [...conn.db.sharedParticipants.iter()].length === 4,
    `Hidden Cup is published but private and has 2 participants seeded; the shared participant cache holds ${[...conn.db.sharedParticipants.iter()].length} rows (Cup's 4 only)`,
  );
  const sharedParticipants = [...conn.db.sharedParticipants.iter()];
  const sharedResults = [...conn.db.sharedResults.iter()];
  record(
    "shared-audience-fields",
    sharedParticipants.length === 4 &&
      sharedResults.length === 1 &&
      Object.keys(sharedResults[0]).sort().join(",") === "matchKey,seq,sides",
    `participants=${sharedParticipants.length}, results=${sharedResults.length}, result keys=${sharedResults.length ? Object.keys(sharedResults[0]).sort().join(",") : "(none)"} — no recordedBy, no row-id handles`,
  );
  return viewEvents;
}

// (3) Sender gating at the wire: the organizer's list holds their
// tournaments (the draft and the private one included); a second
// organizer — bound via spikeBind, so the ownership check itself is
// what answers — sees none of them on any Organizer view, while the
// shared surface stays readable.
async function checkSenderGating(conn: SpikeConnection, DbConnection: AnyRow): Promise<void> {
  await subscribe(conn, ["SELECT * FROM my_tournaments"]);
  await sleep(200);
  const mine = [...conn.db.myTournaments.iter()]
    .map((row) => row.name)
    .sort((a, b) => a.localeCompare(b));
  const cupId = [...conn.db.myTournaments.iter()].find((row) => row.name === "Cup")?.tournamentId;
  const conn2 = await connect(DbConnection);
  await conn2.reducers.spikeBind();
  await subscribe(conn2, [
    "SELECT * FROM my_tournaments",
    `SELECT * FROM organizer_tournament(${cupId})`,
    `SELECT * FROM organizer_participants(${cupId})`,
    `SELECT * FROM organizer_matches(${cupId})`,
    `SELECT * FROM organizer_results(${cupId})`,
    "SELECT * FROM shared_participants('abc123slug')",
  ]);
  await sleep(300);
  const strangerMine = [...conn2.db.myTournaments.iter()].length;
  const strangerOrganizer =
    [...conn2.db.organizerTournament.iter()].length +
    [...conn2.db.organizerParticipants.iter()].length +
    [...conn2.db.organizerMatches.iter()].length +
    [...conn2.db.organizerResults.iter()].length;
  const strangerShared = [...conn2.db.sharedParticipants.iter()].length;
  record(
    "sender-gated-my-tournaments",
    mine.join(",") === "Cup,Hidden Cup,Secret Draft" &&
      strangerMine === 0 &&
      strangerOrganizer === 0 &&
      strangerShared === 4,
    `organizer (${conn.identity.toHexString().slice(0, 8)}…) sees [${mine.join(", ")}]; bound stranger sees ${strangerMine} of theirs, ${strangerOrganizer} organizer rows for the owner's tournament, and ${strangerShared} shared participants`,
  );
}

// (4) Composition over the shared surface: matches + results +
// engine yields the bracket — W1M1 decided for Ada, the final
// pending on W1M2.
function checkComposition(conn: SpikeConnection): void {
  const before = composeShared(conn);
  const firstMatch = before.matches.find((match) => match.key === "W1M1");
  const ada = [...conn.db.sharedParticipants.iter()].find((row) => row.name === "Ada");
  record(
    "shared-composition",
    firstMatch?.state === "completed" &&
      ada !== undefined &&
      firstMatch.winnerId === String(ada.participantId) &&
      before.readyMatchKeys.join(",") === "W1M2",
    `W1M1 state=${firstMatch?.state} winner=${firstMatch?.winnerId} (Ada=${ada ? String(ada.participantId) : "?"}), ready=[${before.readyMatchKeys.join(",")}]`,
  );
}

// (5) Live updates: the mutation appends a result and renames the
// tournament. Argument views carry no primary key, so the rename
// must arrive as delete+insert, never as an update event.
async function checkLiveUpdates(conn: SpikeConnection, viewEvents: string[]): Promise<void> {
  await conn.reducers.spikeMutate();
  await sleep(600);
  const resultsAfter = [...conn.db.sharedResults.iter()].length;
  const nameAfter = [...conn.db.sharedTournament.iter()].map((row) => row.name);
  const after = composeShared(conn);
  record(
    "view-live-updates",
    resultsAfter === 2 &&
      nameAfter.join(",") === "Cup Finals" &&
      viewEvents.some((event) => event.includes("shared_tournament delete name=Cup")) &&
      !viewEvents.some((event) => event.includes("UPDATE")) &&
      after.readyMatchKeys.join(",") === "W2M1",
    `results 1→${resultsAfter}, name→${nameAfter.join(",")}, events=[${viewEvents.join(" | ")}], ready after=[${after.readyMatchKeys.join(",")}]`,
  );
}

main().catch((error) => {
  console.error("SPIKE FAILED", error);
  process.exit(1);
});
