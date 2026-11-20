#!/usr/bin/env bun
// fallow-ignore-file coverage-gaps -- its tests drive it as a subprocess (the only way to run a Bun script with its own Glob and cwd), and a subprocess is not an import edge (see .fallowrc.jsonc)
//
// Prose comments are banned in this repo. A comment that carries a fact
// belongs in an ADR or a doc; a comment that repeats the code belongs
// nowhere. Machine directives (below) are not prose: they are
// instructions to tools and stay exempt. The prose comments that
// legitimately remain are recorded in the baseline beside this script;
// the baseline may only shrink. `--update` regenerates it after comments
// were intentionally removed or moved — review its diff like code.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const BASELINE_PATH = join("scripts", "lint-comments.baseline.json");

// A comment is a machine directive when every one of its content lines
// matches one of these. Anything else is prose.
const DIRECTIVE_LINE: readonly RegExp[] = [
  /^#!/, // shebang (kept unstripped by stripMarkers)
  /^\/\/\/\s*<reference\b/, // /// <reference ... />
  /^@public$/,
  /^@package$/,
  /^@private$/,
  /^import-lint-(disable|enable)\b/,
  /^fallow-ignore(-file|-next-line)?\b/,
  /^(oxlint|eslint)-(disable|enable)(-next-line|-line)?\b/,
  /^@ts-(expect-error|ignore|nocheck)\b/,
  /^@vite-ignore\b/,
  /^@__PURE__\b/,
  /^#__PURE__\b/,
  /^(prettier-ignore|oxfmt-ignore|biome-ignore)\b/,
  /^(v8|istanbul|c8)\s+ignore\b/,
  /^@generated\b/,
  /^DO NOT EDIT\b/,
  /^(SPDX-License-Identifier|Copyright\b|License\b)/,
  /^shellcheck\b/,
  /^yamllint\b/,
];

const EXCLUDED_PREFIXES = [
  "node_modules/",
  "convex/_generated/",
  "spacetimedb/bindings/",
  ".claude/skills/",
  ".agents/skills/",
  ".cursor/",
  ".deepsec/",
  "dist/",
];
const EXCLUDED_FILES = new Set([".claude/hooks/fallow-gate.sh"]);
const SCANNED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".jsonc",
  ".yml",
  ".yaml",
  ".sh",
];
const SCANNED_NAMES = new Set([".env.example"]);

type CommentBlock = { startLine: number; endLine: number; raw: string; kind: "line" | "block" };

function stripMarkers(raw: string): string[] {
  if (raw.startsWith("//") || raw.startsWith("#")) {
    return raw.split("\n").map((line) => {
      const trimmed = line.trimStart();
      // Shebangs and /// <reference ... /> are directives in their raw
      // form; stripping their markers would make them unrecognisable.
      if (trimmed.startsWith("#!") || trimmed.startsWith("///")) return line.trim();
      return line.replace(/^\s*(?:\/\/\/?|#)\s?/, "").trim();
    });
  }
  const body = raw.replace(/^\/\*\*?/, "").replace(/\*\/$/, "");
  return body.split("\n").map((line) => line.replace(/^\s*\*\s?/, "").trim());
}

function isDirective(raw: string): boolean {
  const lines = stripMarkers(raw).filter((line) => line !== "");
  if (lines.length === 0) return true; // empty markers carry no prose
  return lines.every((line) => DIRECTIVE_LINE.some((pattern) => pattern.test(line)));
}

function normalize(raw: string): string {
  return stripMarkers(raw).join(" ").replace(/\s+/g, " ").trim();
}

function hashOf(raw: string): string {
  return createHash("sha256").update(normalize(raw)).digest("hex");
}

// --- extraction -----------------------------------------------------------

const REGEX_PREV = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "=>",
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "instanceof",
  "yield",
  "await",
  "do",
  "else",
]);

type RawComment = CommentBlock & { ownLine: boolean };

type ScanState = {
  text: string;
  i: number;
  line: number;
  lineStart: number;
  prev: string;
  mode: "code" | "tpl";
  braceDepth: number;
  stack: { type: "tpl" | "interp"; depth: number }[];
  comments: RawComment[];
};

function pushComment(
  state: ScanState,
  start: number,
  startLine: number,
  kind: "line" | "block",
): void {
  state.comments.push({
    startLine,
    endLine: state.line,
    raw: state.text.slice(start, state.i),
    kind,
    ownLine: state.text.slice(state.lineStart, start).trim() === "",
  });
  state.prev = "comment";
}

function scanLineComment(state: ScanState): void {
  const start = state.i;
  const startLine = state.line;
  while (state.i < state.text.length && state.text[state.i] !== "\n") state.i++;
  pushComment(state, start, startLine, "line");
}

function scanBlockComment(state: ScanState): void {
  const start = state.i;
  const startLine = state.line;
  state.i += 2;
  while (
    state.i < state.text.length &&
    !(state.text[state.i] === "*" && state.text[state.i + 1] === "/")
  ) {
    if (state.text[state.i] === "\n") state.line++;
    state.i++;
  }
  state.i += 2;
  pushComment(state, start, startLine, "block");
}

function scanQuoted(state: ScanState): void {
  // A quote in code position starts a string; it ends at the matching
  // unescaped quote or at end of line (an unterminated quote is JSX
  // text with an apostrophe; the damage is bounded to that line).
  const quote = state.text[state.i];
  let j = state.i + 1;
  while (j < state.text.length && state.text[j] !== "\n") {
    if (state.text[j] === "\\") {
      j += 2;
      continue;
    }
    if (state.text[j] === quote) {
      j++;
      break;
    }
    j++;
  }
  state.i = j;
  state.prev = "string";
}

// One character of a regex literal's body; returns false at the closing
// slash or the end of the line.
function regexStep(state: ScanState, inClass: { value: boolean }): boolean {
  const ch = state.text[state.i];
  if (ch === "\n") return false;
  if (ch === "\\") {
    state.i += 2;
    return true;
  }
  if (ch === "[") inClass.value = true;
  else if (ch === "]") inClass.value = false;
  else if (ch === "/" && !inClass.value) {
    state.i++;
    return false;
  }
  state.i++;
  return true;
}

function scanRegex(state: ScanState): void {
  state.i++;
  const inClass = { value: false };
  while (state.i < state.text.length && regexStep(state, inClass)) {
    // advance until the literal ends
  }
  while (state.i < state.text.length && /[a-z]/i.test(state.text[state.i])) state.i++;
  state.prev = "regex";
}

function stepSlash(state: ScanState): void {
  const nx = state.text[state.i + 1] ?? "";
  if (nx === "/") scanLineComment(state);
  else if (nx === "*") scanBlockComment(state);
  else if (REGEX_PREV.has(state.prev)) scanRegex(state);
  else {
    state.prev = "/";
    state.i++;
  }
}

function stepCloseBrace(state: ScanState): void {
  const top = state.stack[state.stack.length - 1];
  if (top && top.type === "interp" && state.braceDepth === top.depth) {
    state.stack.pop();
    state.mode = "tpl";
  } else {
    state.braceDepth--;
  }
  state.prev = "}";
  state.i++;
}

function stepNewline(state: ScanState): void {
  state.line++;
  state.i++;
  state.lineStart = state.i;
}

function scanRun(state: ScanState, pattern: RegExp, prev: string | null): void {
  let j = state.i;
  while (j < state.text.length && pattern.test(state.text[j])) j++;
  state.prev = prev ?? state.text.slice(state.i, j);
  state.i = j;
}

function stepWord(state: ScanState): boolean {
  const ch = state.text[state.i];
  if (/[A-Za-z_$]/.test(ch)) {
    scanRun(state, /[A-Za-z0-9_$]/, null);
    return true;
  }
  if (/[0-9]/.test(ch)) {
    scanRun(state, /[0-9A-Za-z._]/, "num");
    return true;
  }
  return false;
}

function stepBacktick(state: ScanState): void {
  state.stack.push({ type: "tpl", depth: 0 });
  state.mode = "tpl";
  state.i++;
  state.prev = "string";
}

function stepOpenBrace(state: ScanState): void {
  state.braceDepth++;
  state.prev = "{";
  state.i++;
}

function stepTail(state: ScanState): void {
  const ch = state.text[state.i];
  const nx = state.text[state.i + 1] ?? "";
  if (ch === "=" && nx === ">") {
    state.prev = "=>";
    state.i += 2;
    return;
  }
  if (!/\s/.test(ch)) state.prev = ch;
  state.i++;
}

function stepCode(state: ScanState): void {
  const ch = state.text[state.i];
  if (ch === "\n") return stepNewline(state);
  if (ch === "/") return stepSlash(state);
  if (ch === "'" || ch === '"') return scanQuoted(state);
  if (ch === "`") return stepBacktick(state);
  if (ch === "{") return stepOpenBrace(state);
  if (ch === "}") return stepCloseBrace(state);
  if (stepWord(state)) return;
  stepTail(state);
}

function stepTemplate(state: ScanState): void {
  const ch = state.text[state.i];
  const nx = state.text[state.i + 1] ?? "";
  if (ch === "\\") {
    state.i += 2;
  } else if (ch === "\n") {
    stepNewline(state);
  } else if (ch === "`") {
    state.stack.pop();
    state.mode = "code";
    state.prev = "string";
    state.i++;
  } else if (ch === "$" && nx === "{") {
    state.stack.push({ type: "interp", depth: state.braceDepth });
    state.mode = "code";
    state.i += 2;
    state.prev = "{";
  } else {
    state.i++;
  }
}

function groupLineComments(comments: RawComment[]): CommentBlock[] {
  // Group line comments: a group continues onto the next line only when
  // that line's comment is an own-line comment (nothing but indentation
  // before it) — the text between the two is then whitespace alone.
  const grouped: CommentBlock[] = [];
  for (const comment of comments) {
    const last = grouped[grouped.length - 1];
    if (
      last &&
      comment.kind === "line" &&
      last.kind === "line" &&
      comment.ownLine &&
      comment.startLine === last.endLine + 1
    ) {
      last.endLine = comment.endLine;
      last.raw += `\n${comment.raw}`;
      continue;
    }
    grouped.push({
      startLine: comment.startLine,
      endLine: comment.endLine,
      raw: comment.raw,
      kind: comment.kind,
    });
  }
  return grouped;
}

function extractTsComments(text: string): CommentBlock[] {
  const state: ScanState = {
    text,
    i: 0,
    line: 1,
    lineStart: 0,
    prev: "",
    mode: "code",
    braceDepth: 0,
    stack: [],
    comments: [],
  };
  while (state.i < text.length) {
    if (state.mode === "code") stepCode(state);
    else stepTemplate(state);
  }
  return groupLineComments(state.comments);
}

function isHashAt(rawLine: string, i: number, quote: string): boolean {
  return quote === "" && rawLine[i] === "#" && (i === 0 || /\s/.test(rawLine[i - 1]));
}

function hashCommentStart(rawLine: string): number {
  let quote = "";
  for (let i = 0; i < rawLine.length; i++) {
    const ch = rawLine[i];
    if (quote === "" && (ch === "'" || ch === '"')) quote = ch;
    else if (ch === quote) quote = "";
    else if (isHashAt(rawLine, i, quote)) return i;
  }
  return -1;
}

function extractHashComments(text: string): CommentBlock[] {
  const lines = text.split("\n");
  const out: CommentBlock[] = [];
  lines.forEach((rawLine, index) => {
    const start = hashCommentStart(rawLine);
    if (start >= 0)
      out.push({
        startLine: index + 1,
        endLine: index + 1,
        raw: rawLine.slice(start),
        kind: "line",
      });
  });
  const grouped: CommentBlock[] = [];
  for (const comment of out) {
    const last = grouped[grouped.length - 1];
    if (
      last &&
      comment.startLine === last.endLine + 1 &&
      lines[comment.startLine - 1].trimStart().startsWith("#")
    ) {
      last.endLine = comment.endLine;
      last.raw += `\n${comment.raw}`;
      continue;
    }
    grouped.push({ ...comment });
  }
  return grouped;
}

function extractCssComments(text: string): CommentBlock[] {
  const out: CommentBlock[] = [];
  let i = 0;
  let line = 1;
  while (i < text.length) {
    if (text.startsWith("/*", i)) {
      const startLine = line;
      const end = text.indexOf("*/", i);
      const segment = text.slice(i, end + 2);
      const newlines = segment.split("\n").length - 1;
      out.push({ startLine, endLine: startLine + newlines, raw: segment, kind: "block" });
      line += newlines;
      i = end + 2;
    } else {
      if (text[i] === "\n") line++;
      i++;
    }
  }
  return out;
}

function extractComments(file: string, text: string): CommentBlock[] {
  if (file.endsWith(".css")) return extractCssComments(text);
  if (
    file.endsWith(".yml") ||
    file.endsWith(".yaml") ||
    file.endsWith(".sh") ||
    SCANNED_NAMES.has(file)
  ) {
    return extractHashComments(text);
  }
  return extractTsComments(text);
}

// --- corpus ---------------------------------------------------------------

function isScanned(file: string): boolean {
  if (EXCLUDED_FILES.has(file)) return false;
  if (EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))) return false;
  return SCANNED_NAMES.has(file) || SCANNED_EXTENSIONS.some((ext) => file.endsWith(ext));
}

function corpusFiles(): string[] {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error("lint:comments: `git ls-files` failed — run inside the repository checkout.");
    process.exit(2);
  }
  return result.stdout
    .split("\n")
    .filter((file) => file !== "")
    .filter(isScanned)
    .sort();
}

// --- baseline -------------------------------------------------------------

type ProseEntry = { hash: string; count: number; firstLine: number; sample: string };
type BaselineEntry = { file: string; hash: string; count: number };
type Baseline = { version: 1; entries: BaselineEntry[] };

function proseEntriesForFile(file: string): ProseEntry[] {
  const text = readFileSync(file, "utf8");
  const entries: ProseEntry[] = [];
  const byHash = new Map<string, ProseEntry>();
  for (const block of extractComments(file, text)) {
    if (isDirective(block.raw)) continue;
    const hash = hashOf(block.raw);
    const existing = byHash.get(hash);
    if (existing) existing.count += 1;
    else {
      const entry = {
        hash,
        count: 1,
        firstLine: block.startLine,
        sample: normalize(block.raw).slice(0, 80),
      };
      byHash.set(hash, entry);
      entries.push(entry);
    }
  }
  return entries;
}

function currentProse(): Map<string, ProseEntry[]> {
  const byFile = new Map<string, ProseEntry[]>();
  for (const file of corpusFiles()) {
    const entries = proseEntriesForFile(file);
    if (entries.length > 0) byFile.set(file, entries);
  }
  return byFile;
}

function toBaseline(byFile: Map<string, ProseEntry[]>): Baseline {
  const entries: BaselineEntry[] = [];
  for (const file of [...byFile.keys()].sort()) {
    for (const entry of byFile.get(file)!)
      entries.push({ file, hash: entry.hash, count: entry.count });
  }
  entries.sort((a, b) =>
    a.file === b.file ? a.hash.localeCompare(b.hash) : a.file.localeCompare(b.file),
  );
  return { version: 1, entries };
}

function countIn(current: Map<string, ProseEntry[]>, file: string, hash: string): number {
  return current.get(file)?.find((entry) => entry.hash === hash)?.count ?? 0;
}

if (process.argv.includes("--update")) {
  const baseline = toBaseline(currentProse());
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  const total = baseline.entries.reduce((sum, entry) => sum + entry.count, 0);
  console.log(
    `lint:comments baseline updated: ${total} prose comment(s) in ${baseline.entries.length} entr(ies).`,
  );
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(
    `lint:comments: ${BASELINE_PATH} is missing — generate it with \`bun scripts/lint-comments.ts --update\`.`,
  );
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
const baselineByFile = new Map<string, Map<string, number>>();
for (const entry of baseline.entries) {
  if (!baselineByFile.has(entry.file)) baselineByFile.set(entry.file, new Map());
  baselineByFile.get(entry.file)!.set(entry.hash, entry.count);
}

let failures = 0;
const current = currentProse();
for (const [file, entries] of current) {
  const allowed = baselineByFile.get(file) ?? new Map<string, number>();
  for (const entry of entries) {
    const allowedCount = allowed.get(entry.hash) ?? 0;
    if (entry.count > allowedCount) {
      console.error(
        `${file}:${entry.firstLine}: prose comment is not in the baseline (${entry.count - allowedCount} new) — move the fact into an ADR or a doc, or delete the comment`,
      );
      console.error(`  ${entry.sample}`);
      failures += 1;
    }
  }
}
for (const entry of baseline.entries) {
  const currentCount = countIn(current, entry.file, entry.hash);
  if (currentCount < entry.count) {
    console.error(
      `${entry.file}: stale baseline entry ${entry.hash.slice(0, 12)} (baseline ${entry.count}, present ${currentCount}) — the baseline may only shrink; regenerate it with \`bun scripts/lint-comments.ts --update\` and review the diff`,
    );
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\nlint:comments failed with ${failures} finding(s).`);
  process.exit(1);
}
console.log("lint:comments passed.");
