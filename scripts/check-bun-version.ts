#!/usr/bin/env bun
/**
 * Toolchain guard. Bun enforces neither `packageManager` nor `engines.bun`:
 * it installs happily under any version and says nothing, so a local or agent
 * environment can silently resolve the lockfile with a Bun the project does
 * not claim to support. (Observed: 1.3.11 installing against
 * `packageManager: bun@1.4.0` without a warning.) pnpm/corepack would fetch
 * the declared version instead; this script is the Bun-side substitute.
 *
 * The two fields mean different things, so they are checked differently:
 *
 * - `engines.bun` is the supported range. Outside it, fail — that is the case
 *   where install behaviour and lockfile handling are genuinely unvouched for.
 * - `packageManager` is the exact pin CI installs. Inside the range but off
 *   the pin is only worth a notice: erroring there would contradict the range
 *   the project just declared it supports.
 *
 * CI passes `--strict`, which promotes that notice to a failure. There the
 * runner installs BUN_VERSION, so an inexact match means the workflow and
 * `packageManager` have drifted apart — the one mismatch a range check cannot
 * see, since both versions sit inside the range.
 */

type PackageJson = {
  engines?: { bun?: string };
  packageManager?: string;
};

const pkg: PackageJson = await Bun.file(new URL("../package.json", import.meta.url)).json();

const range = pkg.engines?.bun;
const pinned = pkg.packageManager;
const running = Bun.version;
const strict = Bun.argv.includes("--strict");

const problems: string[] = [];

if (!range) {
  problems.push("package.json has no `engines.bun`; the supported Bun range is undeclared");
}

if (!pinned) {
  problems.push("package.json has no `packageManager`; the exact Bun version is unpinned");
} else if (!pinned.startsWith("bun@")) {
  problems.push(`packageManager is \`${pinned}\`, which does not name Bun — this repo is Bun-only`);
}

const pinnedVersion = pinned?.startsWith("bun@") ? pinned.slice("bun@".length) : undefined;

// A pin outside its own supported range is a config bug, whatever is running.
if (range && pinnedVersion && !Bun.semver.satisfies(pinnedVersion, range)) {
  problems.push(
    `packageManager pins bun@${pinnedVersion}, which does not satisfy engines.bun \`${range}\` — fix one of them`,
  );
}

if (range && !Bun.semver.satisfies(running, range)) {
  problems.push(
    `running Bun ${running} does not satisfy engines.bun \`${range}\`. ` +
      `Install the pinned version: curl -fsSL https://bun.sh/install | bash -s "bun-v${pinnedVersion ?? "<version>"}"`,
  );
}

// Supported, just not the pinned build. Locally that is a caveat on any
// version-sensitive result; under --strict (CI) it means the workflow's
// BUN_VERSION and `packageManager` disagree, which is a config bug.
const offPin = pinnedVersion !== undefined && running !== pinnedVersion;

if (offPin && strict) {
  problems.push(
    `running Bun ${running} is not the pinned bun@${pinnedVersion}. ` +
      `In CI these must match exactly: bring BUN_VERSION in .github/workflows/deploy.yml ` +
      `and \`packageManager\` in package.json back in step.`,
  );
}

if (problems.length > 0) {
  console.error("check:bun failed:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

if (offPin) {
  console.warn(
    `check:bun: running Bun ${running}, pinned bun@${pinnedVersion} (within engines.bun \`${range}\`). ` +
      `CI uses the pin — reproduce there before trusting a version-sensitive result.`,
  );
}

console.log(`check:bun passed (Bun ${running}).`);
