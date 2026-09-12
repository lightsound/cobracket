import { mkdtemp, mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

// The guard reads package.json relative to its own file and reports on the
// Bun that executes it, so it is exercised as a subprocess against a throwaway
// project rather than imported. That keeps the real `Bun.semver` in the loop —
// the version maths is the part worth testing, and it does not exist under the
// node environment this test runs in.

const SCRIPT = join(import.meta.dirname, "check-bun-version.ts");

let root: string;
let script: string;
/** The version the subprocess will report, so cases can be built around it. */
let running: string;

function versionOffPatch(version: string): string {
  const [major, minor, patch] = version.split(".");
  return `${major}.${minor}.${Number(patch?.split("-")[0] ?? 0) + 1}`;
}

function caretOf(version: string): string {
  const [major, minor] = version.split(".");
  return `^${major}.${minor}.0`;
}

async function run(
  pkg: Record<string, unknown>,
  ...args: string[]
): Promise<{ status: number; output: string }> {
  await writeFile(join(root, "package.json"), JSON.stringify(pkg, null, 2));
  const result = spawnSync("bun", [script, ...args], { encoding: "utf8" });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "cobracket-check-bun-"));
  await mkdir(join(root, "scripts"));
  script = join(root, "scripts", "check-bun-version.ts");
  await copyFile(SCRIPT, script);

  const probe = spawnSync("bun", ["--version"], { encoding: "utf8" });
  running = (probe.stdout ?? "").trim();
  expect(running, "the tests need a Bun on PATH to drive the guard").toMatch(/^\d+\.\d+\.\d+/);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("check:bun", () => {
  test("passes on the pinned version", async () => {
    const { status, output } = await run({
      engines: { bun: caretOf(running) },
      packageManager: `bun@${running}`,
    });
    expect(status).toBe(0);
    expect(output).toContain(`check:bun passed (Bun ${running})`);
  });

  test("passes under --strict on the pinned version", async () => {
    const { status } = await run(
      { engines: { bun: caretOf(running) }, packageManager: `bun@${running}` },
      "--strict",
    );
    expect(status).toBe(0);
  });

  test("fails when the running Bun is outside engines.bun, naming the installer", async () => {
    const { status, output } = await run({
      engines: { bun: "^99.0.0" },
      packageManager: "bun@99.1.0",
    });
    expect(status).toBe(1);
    expect(output).toContain(`running Bun ${running} does not satisfy engines.bun \`^99.0.0\``);
    expect(output).toContain('bash -s "bun-v99.1.0"');
  });

  test("only warns when in range but off the pin, and fails under --strict", async () => {
    const pkg = {
      engines: { bun: caretOf(running) },
      packageManager: `bun@${versionOffPatch(running)}`,
    };

    const lenient = await run(pkg);
    expect(lenient.status).toBe(0);
    expect(lenient.output).toContain("CI uses the pin");

    const strict = await run(pkg, "--strict");
    expect(strict.status).toBe(1);
    expect(strict.output).toContain("is not the pinned");
  });

  // Regression: corepack may append an integrity hash to `packageManager`.
  // Semver treats it as build metadata and ignores it; a string compare does
  // not, and failed CI on the very version it had just installed.
  test("ignores a corepack integrity hash on the pin", async () => {
    const { status, output } = await run(
      {
        engines: { bun: caretOf(running) },
        packageManager: `bun@${running}+sha512.abcdef0123456789`,
      },
      "--strict",
    );
    expect(status).toBe(0);
    expect(output).not.toContain("is not the pinned");
  });

  // A higher minor inside a caret range is NOT a contradiction: ^1.4.0 admits
  // 1.5.0. Asserted because the first hand-run of these cases assumed it was,
  // and a guard that rejected it would block every routine minor bump.
  test("accepts a pin on a higher minor within the caret range", async () => {
    const [major, minor] = running.split(".");
    const higherMinor = `${major}.${Number(minor) + 1}.0`;

    const { status, output } = await run({
      engines: { bun: caretOf(running) },
      packageManager: `bun@${higherMinor}`,
    });
    expect(output).not.toContain("does not satisfy engines.bun");
    expect(status).toBe(0);
  });

  test("fails when the pin sits outside its own engines range", async () => {
    const { status, output } = await run({
      engines: { bun: caretOf(running) },
      packageManager: "bun@1.0.0",
    });
    expect(status).toBe(1);
    expect(output).toContain("does not satisfy engines.bun");
    expect(output).toContain("fix one of them");
  });

  test("fails when packageManager names another package manager", async () => {
    const { status, output } = await run({
      engines: { bun: caretOf(running) },
      packageManager: "pnpm@10.0.0",
    });
    expect(status).toBe(1);
    expect(output).toContain("does not name Bun");
  });

  test("fails when the pin is a range or a tag rather than an exact version", async () => {
    for (const pin of ["bun@^1.4.0", "bun@1.4", "bun@latest"]) {
      const { status, output } = await run({
        engines: { bun: caretOf(running) },
        packageManager: pin,
      });
      expect(status, pin).toBe(1);
      expect(output, pin).toContain("must be exact");
    }
  });

  test("fails when either field is missing", async () => {
    const noRange = await run({ packageManager: `bun@${running}` });
    expect(noRange.status).toBe(1);
    expect(noRange.output).toContain("no `engines.bun`");

    const noPin = await run({ engines: { bun: caretOf(running) } });
    expect(noPin.status).toBe(1);
    expect(noPin.output).toContain("no `packageManager`");
  });

  test("reports every problem in one run rather than stopping at the first", async () => {
    const { status, output } = await run({});
    expect(status).toBe(1);
    expect(output).toContain("no `engines.bun`");
    expect(output).toContain("no `packageManager`");
  });
});
