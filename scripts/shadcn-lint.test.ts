import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

// @shadcn/lint (ADR 0012) supports React, Vue and Svelte. It reads Solid's
// `class` because Solid spells it the way Vue does, not because Solid is
// supported, so a release that narrows what it reads would leave `vp check`
// green by no longer looking. This pins the forms this repo writes: each
// fixture line is a mistake in one of them, and each must still be reported.
//
// The fixture lives outside the repo so it never reaches `src/`, with the real
// theme copied beside it (the plugin reads the theme from the linted file's
// package) and the repo's own `lint` block loaded through `vp`, so the config
// under test is the one `vp check` runs. Known blind spots, left unasserted so
// a fix upstream does not fail this test: a bare object `class={{ ... }}`
// (write it inside an array) and a string `style="..."` (lint:theme bans
// `style` outside src/bracket either way).

const REPO = join(import.meta.dirname, "..");

const FIXTURE = [
  `const tone = "text-ink-mute";`,
  `export const Fixture = (props: { on: boolean }) => (`,
  `  <div>`,
  `    <p class="flex items-cente">string</p>`,
  `    <p class={["flex", { "text-ink-mute": props.on }]}>object in array</p>`,
  `    <p class={["flex", props.on && "bg-red-500"]}>and in array</p>`,
  `    <p class={\`flex \${props.on ? "p-[13px]" : ""}\`}>template</p>`,
  `    <p class={tone}>constant</p>`,
  `    <p class="bg-surface" style={{ padding: "1px" }}>style property</p>`,
  `    <p class="translate-x-(--x)" style={{ "--x": "1px" }}>custom property</p>`,
  `    <p class="bg-surface text-ink">tokens</p>`,
  `  </div>`,
  `);`,
  ``,
].join("\n");

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "cobracket-shadcn-lint-"));
  await mkdir(join(root, "src"));
  await copyFile(join(REPO, "src/theme.css"), join(root, "src/theme.css"));
  await symlink(join(REPO, "node_modules"), join(root, "node_modules"), "dir");
  await writeFile(join(root, "package.json"), `{ "private": true, "type": "module" }\n`);
  await writeFile(
    join(root, "vite.config.ts"),
    [
      `import config from ${JSON.stringify(join(REPO, "vite.config.ts"))};`,
      `const { lint } = config({ mode: "production", command: "build" });`,
      // Type-aware checks need the repo's tsconfig; this test is about classes.
      `export default { lint: { ...lint, options: { typeAware: false, typeCheck: false } } };`,
      ``,
    ].join("\n"),
  );
  await writeFile(join(root, "src/Fixture.tsx"), FIXTURE);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("reports a mistake in every class form this repo writes", () => {
  const result = spawnSync(
    join(REPO, "node_modules/.bin/vp"),
    ["lint", "--format", "json", "src"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  const { diagnostics } = JSON.parse(result.stdout) as {
    diagnostics: { code: string; labels: { span: { line: number } }[] }[];
  };
  const found = diagnostics
    .filter((diagnostic) => diagnostic.code.startsWith("shadcn("))
    .map((diagnostic) => `${diagnostic.labels[0]?.span.line} ${diagnostic.code}`)
    .sort();

  expect(found).toEqual(
    [
      "1 shadcn(no-raw-colors)", // constant, reported where it is declared
      "4 shadcn(no-unknown-classes)", // string
      "5 shadcn(no-raw-colors)", // object in array
      "6 shadcn(no-raw-colors)", // `&&` in array
      "7 shadcn(no-arbitrary-values)", // template literal
      "9 shadcn(no-inline-styles)", // style property
      // 10 and 11 are clean: a custom property, and plain tokens.
    ].sort(),
  );
});
