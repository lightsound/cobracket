import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

// The guard enumerates its corpus with `git ls-files` relative to the
// working directory, so it is driven as a subprocess against a throwaway
// git tree rather than imported: that keeps git and the file system in
// the loop, and lets a case be exactly the two or three lines it is
// about. It runs under Bun for the same reason the script does.

const SCRIPT = join(import.meta.dirname, "lint-comments.ts");
const BASELINE = join("scripts", "lint-comments.baseline.json");

let root: string;

function git(...args: string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

async function write(path: string, contents: string): Promise<void> {
  const full = join(root, path);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents);
}

function run(...args: string[]): { status: number; output: string } {
  const result = spawnSync("bun", [SCRIPT, ...args], { cwd: root, encoding: "utf8" });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

async function setup(files: Record<string, string>): Promise<void> {
  await rm(join(root, "src"), { recursive: true, force: true });
  await rm(join(root, "scripts"), { recursive: true, force: true });
  await rm(join(root, ".github"), { recursive: true, force: true });
  for (const [path, contents] of Object.entries(files)) await write(path, contents);
  git("add", "-A");
}

// Sets up a fresh tree: the given files, a baseline generated from them
// (or the given baseline text), then a plain check run.
async function lint(
  files: Record<string, string>,
  baseline?: string,
): Promise<{ status: number; output: string }> {
  await setup(files);
  if (baseline === undefined) {
    const updated = run("--update");
    if (updated.status !== 0) throw new Error(`--update failed: ${updated.output}`);
  } else {
    await write(BASELINE, baseline);
  }
  git("add", "-A");
  return run();
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "cobracket-lint-comments-"));
  git("init", "-q");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("lint:comments", () => {
  test("passes on code without comments", async () => {
    const { status, output } = await lint({
      "src/Plain.ts": `export const a = 1;\n`,
    });
    expect(status).toBe(0);
    expect(output).toContain("lint:comments passed.");
  });

  test("passes on the prose comments the baseline records", async () => {
    const { status, output } = await lint({
      "src/Noted.ts": `// Why this exists: the fixture needs one baselined comment.\nexport const a = 1;\n`,
    });
    expect(status).toBe(0);
    expect(output).toContain("lint:comments passed.");
  });

  test("rejects a prose comment that is not in the baseline", async () => {
    const { status, output } = await lint(
      {
        "src/Noted.ts": `// Baselined.\nexport const a = 1;\n// A new opinion.\nexport const b = 2;\n`,
      },
      `{"version":1,"entries":[]}\n`,
    );
    expect(status).toBe(1);
    expect(output).toContain("src/Noted.ts:1:");
    expect(output).toContain("src/Noted.ts:3:");
    expect(output).toContain("not in the baseline");
  });

  test("rejects a baseline entry whose comment no longer exists", async () => {
    await setup({ "src/Noted.ts": `// Baselined.\nexport const a = 1;\n` });
    const updated = run("--update");
    if (updated.status !== 0) throw new Error(`--update failed: ${updated.output}`);
    git("add", "-A");
    await write("src/Noted.ts", `export const a = 1;\n`);
    git("add", "-A");
    const { status, output } = run();
    expect(status).toBe(1);
    expect(output).toContain("stale baseline entry");
    expect(output).toContain("may only shrink");
  });

  test("allows machine directives without a baseline entry", async () => {
    const { status, output } = await lint(
      {
        "src/Directives.ts": [
          `#!/usr/bin/env bun`,
          `/** @public */`,
          `export const a = 1;`,
          `// fallow-ignore-next-line code-duplication -- mirrors the other backend until M6`,
          `export const b = 2;`,
          `// oxlint-disable-next-line no-console -- the CLI entry point reports to stderr`,
          `console.log(a, b);`,
          ``,
        ].join("\n"),
      },
      `{"version":1,"entries":[]}\n`,
    );
    expect(status).toBe(0);
    expect(output).toContain("lint:comments passed.");
  });

  test("does not read comment markers inside strings", async () => {
    const { status, output } = await lint(
      {
        "src/Strings.ts": [
          "export const url = `https://example.com/a//b`;",
          `export const text = "not a /* comment */ either";`,
          ``,
        ].join("\n"),
      },
      `{"version":1,"entries":[]}\n`,
    );
    expect(status).toBe(0);
    expect(output).toContain("lint:comments passed.");
  });

  test("covers hash comments in workflows", async () => {
    const { status, output } = await lint(
      { ".github/workflows/ci.yml": `# A new opinion about CI.\njobs: {}\n` },
      `{"version":1,"entries":[]}\n`,
    );
    expect(status).toBe(1);
    expect(output).toContain(".github/workflows/ci.yml:1:");
  });
});
