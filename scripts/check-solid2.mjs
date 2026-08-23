#!/usr/bin/env bun
// Mechanical guard against React and Solid 1.x patterns in Solid 2.0 source.
// Complements .cursor/rules/solid-2.mdc: guidance steers agents, this gate
// catches what slips through. Whole-file regex over src/**/*.{ts,tsx} so
// multi-line constructs (e.g. Prettier-wrapped destructured params) are caught.
// Usage: `bun run lint:solid`. Exits 1 with file:line findings.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

const CHECKS = [
  {
    id: 'props-destructure-param',
    pattern: /function\s+[A-Z]\w*\s*\(\s*\{|(?:const|let)\s+[A-Z]\w*\s*=\s*(?:async\s*)?\(\s*\{/g,
    message:
      'Destructured component props read getters once at setup and break reactivity. Take a single `props` parameter and read `props.x` inside JSX, memos, or effect computes (solid/no-destructure).',
  },
  {
    id: 'props-destructure-body',
    pattern: /\}\s*=\s*props\b/g,
    message:
      'Destructuring `props` freezes the values. Keep `props.x` property accesses; name derivations instead: `const x = () => props.x`.',
  },
  {
    id: 'react-import',
    pattern: /from\s+['"]react(?:-dom)?(?:['"]|\/)/g,
    message: 'React import in a Solid 2.0 codebase.',
  },
  {
    id: 'solid1-import-path',
    pattern: /from\s+['"]solid-js\/(?:store|web|h|html|universal|jsx-runtime|jsx-dev-runtime)['"]/g,
    message:
      'Solid 1.x import path. Stores/merge/omit come from "solid-js"; render/hydrate/Portal/Dynamic come from "@solidjs/web".',
  },
  {
    id: 'react-jsx-prop',
    pattern: /\b(?:className|htmlFor)=/g,
    message: 'React JSX prop. Use `class` / `for` (solid/no-react-specific-props).',
  },
  {
    id: 'solid1-classlist',
    pattern: /\bclassList=/g,
    message: 'Solid 1.x `classList` was removed. Use the object/array form of `class`.',
  },
  {
    id: 'react-hook',
    pattern:
      /(?<![.\w])use(?:State|Effect|Memo|Ref|Callback|Reducer|LayoutEffect|Transition|SyncExternalStore|ImperativeHandle)\s*\(/g,
    message: 'React hook. See the primitive mapping in .cursor/rules/solid-2.mdc.',
  },
  {
    id: 'solid1-api',
    pattern:
      /(?<![.\w])(?:createResource|onMount|createMutable|modifyMutable|mergeProps|splitProps|produce|unwrap|createComputed|createSelector|createDeferred|startTransition|batch)\s*\(/g,
    message:
      'Removed Solid 1.x API. Replacements: async createMemo, onSettled, createStore drafts, merge/omit/snapshot, automatic batching.',
  },
  {
    id: 'solid1-component',
    pattern: /<(?:Suspense|ErrorBoundary|SuspenseList|Index)[\s/>]/g,
    message: 'Solid 1.x component. Use <Loading>, <Errored>, <Reveal>, <For keyed={false}>.',
  },
  {
    id: 'context-provider',
    pattern: /<\w+\.Provider\b/g,
    message: 'Solid 2 contexts are their own provider: `<MyContext value={...}>`.',
  },
  {
    // Matches a camelCase key in property position (right after `{{` or after a
    // comma). Ternary branches inside values (`a ? fooBar : baz`) never sit in
    // property position, so they are not flagged.
    id: 'style-camelcase',
    pattern: /style=\{\{\s*(?:[^{}]*,\s*)?[a-z]+[A-Z]\w*\s*:/g,
    message:
      'camelCase style key. Solid style objects use CSS property names: `"background-color"` (and no automatic px).',
  },
  {
    id: 'react-key-prop',
    pattern: /\skey=\{/g,
    message: 'React `key` prop has no meaning in Solid. Row identity belongs on <For keyed={...}>.',
  },
];

// .ts / .tsx sources, excluding .d.ts declaration files.
const SOURCE_FILE = /(?<!\.d)\.tsx?$/;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (SOURCE_FILE.test(entry.name)) yield path;
  }
}

let findings = 0;
let files = 0;

for (const file of walk(SRC)) {
  files += 1;
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');
  for (const check of CHECKS) {
    for (const match of content.matchAll(check.pattern)) {
      findings += 1;
      const lineNumber = content.slice(0, match.index).split('\n').length;
      console.error(
        `${relative(ROOT, file)}:${lineNumber} [${check.id}] ${check.message}\n  > ${lines[lineNumber - 1].trim()}`,
      );
    }
  }
}

if (findings > 0) {
  console.error(`\nlint:solid — ${findings} finding(s) in ${files} file(s).`);
  process.exit(1);
}
console.log(`lint:solid — OK (${files} files scanned).`);
