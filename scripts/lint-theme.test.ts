import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

// The guard globs `src/**/*.{ts,tsx,css}` relative to the working directory,
// so it is driven as a subprocess against a throwaway `src/` rather than
// imported: that keeps Bun's own `Glob` and `Bun.file` in the loop, and lets a
// case be exactly the two or three lines it is about. It runs under Bun for
// the same reason the script does.

const SCRIPT = join(import.meta.dirname, "lint-theme.ts");

let root: string;

async function lint(files: Record<string, string>): Promise<{ status: number; output: string }> {
  await rm(join(root, "src"), { recursive: true, force: true });
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, contents);
  }
  const result = spawnSync("bun", [SCRIPT], { cwd: root, encoding: "utf8" });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "cobracket-lint-theme-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("lint:theme", () => {
  test("passes on semantic tokens", async () => {
    const { status, output } = await lint({
      "src/Ok.tsx": `export const cls = "bg-surface text-ink border-ink-muted/40";\n`,
      "src/ok.css": `.live { color: var(--color-live); }\n`,
    });
    expect(status).toBe(0);
    expect(output).toContain("lint:theme passed.");
  });

  test("rejects a scheme variant, naming the file and line", async () => {
    const { status, output } = await lint({
      "src/Card.tsx": `export const a = "bg-surface";\nexport const b = "bg-white dark:bg-black";\n`,
    });
    expect(status).toBe(1);
    expect(output).toContain("src/Card.tsx:2:");
    expect(output).toContain("scheme variant is banned");
    expect(output).toContain("1 finding(s)");
  });

  test("rejects arbitrary color values in every notation", async () => {
    const { status, output } = await lint({
      "src/Hex.tsx": `export const a = "bg-[#ff0000]";\n`,
      "src/Rgb.tsx": `export const a = "text-[rgb(0_0_0)]";\n`,
      "src/Oklch.tsx": `export const a = "border-[oklch(0.7_0.1_20)]";\n`,
      "src/Mix.tsx": `export const a = "bg-[color-mix(in_oklch,red,blue)]";\n`,
      "src/Hsl.css": `.x { background: theme(--x-[hsl(0,0%,0%)]); }\n`,
    });
    expect(status).toBe(1);
    expect(output).toContain("arbitrary color value is banned");
    expect(output).toContain("5 finding(s)");
  });

  test("leaves src/theme.css alone — it is where token values live", async () => {
    const { status, output } = await lint({
      // The real file carries both patterns: the policy's own prose, and
      // `light-dark()` pairs written as arbitrary values.
      "src/theme.css": `/* dark:bg-black is banned elsewhere */\n.x { color: light-dark(#fff, #000); }\n.y { --z: var(--w-[#abc]); }\n`,
    });
    expect(status).toBe(0);
    expect(output).toContain("lint:theme passed.");
  });

  test("does not fire on prose or an object key that merely says dark", async () => {
    const { status, output } = await lint({
      "src/notes.ts": [
        `// dark: the palette is theme-complete, so no variant is needed`,
        `export const themes = { dark: "dark", light: "light" };`,
        `export const label = "Theme: Dark";`,
        ``,
      ].join("\n"),
    });
    expect(status).toBe(0);
    expect(output).toContain("lint:theme passed.");
  });

  test("reports every finding rather than stopping at the first", async () => {
    const { status, output } = await lint({
      "src/A.tsx": `export const a = "dark:bg-black";\nexport const b = "bg-[#fff]";\n`,
      "src/B.tsx": `export const c = "dark:text-white";\n`,
    });
    expect(status).toBe(1);
    expect(output).toContain("src/A.tsx:1:");
    expect(output).toContain("src/A.tsx:2:");
    expect(output).toContain("src/B.tsx:1:");
    expect(output).toContain("3 finding(s)");
  });
});
