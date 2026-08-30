#!/usr/bin/env bun
/**
 * Theme guard (ADR 0007). Every color utility must reference a semantic
 * token from src/theme.css, whose values pair light and dark via
 * light-dark(). A single class is therefore theme-complete, and per-scheme
 * variant prefixes are banned outright: a variant that must be remembered
 * on every color utility is a variant that will be forgotten.
 */
import { Glob } from "bun";

const RULES = [
  {
    // Variant usage is dark:utility (no space); a plain `dark:` object key
    // or prose followed by whitespace is not a finding.
    pattern: /\bdark:[a-z![-]/i,
    message:
      "scheme variant is banned: tokens are theme-complete via light-dark(); style with bg-surface, text-ink, ... only",
  },
  {
    pattern: /-\[(?:#|rgb|hsl|oklch|color-mix)/,
    message: "arbitrary color value is banned: define a semantic token in src/theme.css instead",
  },
] as const;

let failures = 0;
const glob = new Glob("src/**/*.{ts,tsx,css}");
for await (const file of glob.scan(".")) {
  // theme.css is the one place token values (and this policy's prose) live.
  if (file.endsWith("theme.css")) continue;
  const lines = (await Bun.file(file).text()).split("\n");
  lines.forEach((line, index) => {
    for (const rule of RULES) {
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
