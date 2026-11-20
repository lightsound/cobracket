#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
