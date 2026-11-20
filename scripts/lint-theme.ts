#!/usr/bin/env bun
// fallow-ignore-file coverage-gaps -- its tests drive it as a subprocess (the only way to run a Bun script with its own Glob and cwd), and a subprocess is not an import edge (see .fallowrc.jsonc)
import { Glob } from "bun";

type Rule = { pattern: RegExp; message: string; applies?: (file: string) => boolean };

const RULES: readonly Rule[] = [
  {
    // Variant usage is dark:utility (no space); a plain `dark:` object key
    // or prose followed by whitespace is not a finding.
    pattern: /\bdark:[a-z![-]/i,
    message:
      "scheme variant is banned: tokens are theme-complete via light-dark(); style with bg-surface, text-ink, ... only",
  },
  {
    pattern: /\sstyle=[{"']/,
    message:
      "style is banned outside src/bracket: style with classes; runtime geometry belongs to the Bracket",
    applies: (file) => file.endsWith(".tsx") && !file.startsWith("src/bracket/"),
  },
];

let failures = 0;
const glob = new Glob("src/**/*.{ts,tsx,css}");
for await (const file of glob.scan(".")) {
  if (file.endsWith("theme.css")) continue;
  const rules = RULES.filter((rule) => rule.applies?.(file) ?? true);
  const lines = (await Bun.file(file).text()).split("\n");
  lines.forEach((line, index) => {
    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        console.error(`${file}:${index + 1}: ${rule.message}`);
        console.error(`  ${line.trim()}`);
        failures += 1;
      }
    }
  });
}

if (failures > 0) {
  console.error(`\nlint:theme failed with ${failures} finding(s).`);
  process.exit(1);
}
console.log("lint:theme passed.");
