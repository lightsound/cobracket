#!/usr/bin/env bun
/**
 * Theme guard: the bans that follow from this repo's own design decisions.
 * Whether a class exists and uses a theme token is @shadcn/lint's job
 * (ADR 0012, in `vp check`); these two are not questions it can ask, because
 * both patterns are valid Tailwind.
 *
 * - Scheme variants (ADR 0007). Every color token pairs light and dark via
 *   light-dark(), so a single class is theme-complete. A variant that must be
 *   remembered on every color utility is a variant that will be forgotten.
 * - `style` outside src/bracket (ADR 0012). Styling is classes; the one thing
 *   classes cannot carry is geometry computed at runtime, and the Bracket is
 *   the only place that has any. Banning the attribute rather than its
 *   properties also closes the custom-property route: `p-(--gap)` does
 *   nothing unless some `style` sets `--gap`.
 */
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
    // The JSX attribute in either form, object or string.
    pattern: /\sstyle=[{"']/,
    message:
      "style is banned outside src/bracket: style with classes; runtime geometry belongs to the Bracket",
    applies: (file) => file.endsWith(".tsx") && !file.startsWith("src/bracket/"),
  },
];

let failures = 0;
const glob = new Glob("src/**/*.{ts,tsx,css}");
for await (const file of glob.scan(".")) {
  // theme.css is the one place token values (and this policy's prose) live.
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
