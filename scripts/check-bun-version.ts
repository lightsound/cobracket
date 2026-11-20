#!/usr/bin/env bun
/** Toolchain-guard contract: AGENTS.md, Commands (Toolchain guard). */

type PackageJson = {
  engines?: { bun?: string };
  packageManager?: string;
};

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const pkg: PackageJson = await Bun.file(new URL("../package.json", import.meta.url)).json();

const range = pkg.engines?.bun;
const pinned = pkg.packageManager;
const running = Bun.version;
const strict = Bun.argv.includes("--strict");

const problems: string[] = [];

// The guard has to be able to report on the versions it rejects, so it cannot
// assume its own tools exist on them.
if (typeof Bun.semver?.satisfies !== "function" || typeof Bun.semver?.order !== "function") {
  console.error(
    `check:bun failed:\n  - this Bun (${running}) has no \`Bun.semver\`, so the version cannot be checked. ` +
      `It predates every version this project supports; install the pinned one.`,
  );
  process.exit(1);
}

if (!range) {
  problems.push("package.json has no `engines.bun`; the supported Bun range is undeclared");
}

let pinnedVersion: string | undefined;

if (!pinned) {
  problems.push("package.json has no `packageManager`; the exact Bun version is unpinned");
} else if (!pinned.startsWith("bun@")) {
  problems.push(`packageManager is \`${pinned}\`, which does not name Bun — this repo is Bun-only`);
} else {
  const version = pinned.slice("bun@".length);
  if (EXACT_VERSION.test(version)) {
    pinnedVersion = version;
  } else {
    problems.push(
      `packageManager is \`${pinned}\`; the version must be exact (1.4.2), not a range or tag`,
    );
  }
}

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

const offPin = pinnedVersion !== undefined && Bun.semver.order(running, pinnedVersion) !== 0;

if (offPin && strict) {
  problems.push(
    `running Bun ${running} is not the pinned bun@${pinnedVersion}. ` +
      `In CI the runner installs the version read from \`packageManager\`, so this means ` +
      `setup-bun resolved something else — check the bun-version-file step in ` +
      `.github/workflows/deploy.yml.`,
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
