import { expect, test } from "vite-plus/test";
import { workingTreeFiles } from "./fallow-ci";

// The copy is only as faithful as its file list: everything git lists that
// still exists, so an unstaged deletion is not resurrected and an untracked
// new file is checked like a committed one. Running fallow itself is left to
// `bun run fallow:ci`, which verify runs.

test("keeps listed paths that exist and drops deleted ones", () => {
  const listed = "convex/schema.ts\0convex/operations.ts\0convex/model/views.ts\0";
  const onDisk = new Set(["convex/schema.ts", "convex/model/views.ts"]);
  expect(workingTreeFiles(listed, (path) => onDisk.has(path))).toEqual([
    "convex/schema.ts",
    "convex/model/views.ts",
  ]);
});

test("an empty listing copies nothing", () => {
  expect(workingTreeFiles("", () => true)).toEqual([]);
});
