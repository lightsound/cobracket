#!/usr/bin/env bun
/**
 * Runs fallow the way CI's fallow job does (.github/workflows/fallow.yml):
 * on the working tree without node_modules. The job never installs the
 * project's dependencies, and fallow's answers depend on whether they are
 * installed. Measured on the change that split convex/operations.ts (ADR
 * 0020): with node_modules present, fallow 3.27.0 and 3.33.1 alike reported
 * nothing, while CI failed on five findings — four private-type-leaks in
 * convex/model/views.ts and an unused devDependency. A copy of the same tree
 * without node_modules reported all five. So `bun run verify` runs this, and
 * a green local run means a green CI job.
 *
 * The copy holds every tracked and untracked-but-not-ignored file that exists
 * on disk, so unstaged edits are checked and deleted files are not.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The paths `git ls-files -z` listed that still exist in the working tree. */
export function workingTreeFiles(lsFiles: string, exists: (path: string) => boolean): string[] {
  return lsFiles.split("\0").filter((path) => path !== "" && exists(path));
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..");
  const listed = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" },
  );
  if (listed.status !== 0) {
    process.stderr.write(listed.stderr);
    process.exit(1);
  }
  const copy = mkdtempSync(join(tmpdir(), "fallow-ci-"));
  try {
    for (const path of workingTreeFiles(listed.stdout, (file) => existsSync(join(root, file)))) {
      mkdirSync(dirname(join(copy, path)), { recursive: true });
      cpSync(join(root, path), join(copy, path));
    }
    const fallow = spawnSync(
      join(root, "node_modules/.bin/fallow"),
      ["--fail-on-issues", "--quiet"],
      { cwd: copy, stdio: "inherit" },
    );
    process.exitCode = fallow.status ?? 1;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
