import { defineConfig } from "vite-plus";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    solid({
      diagnostics: true,
      refresh: mode === "e2e" ? false : undefined,
      performanceTracks: mode === "e2e" ? false : undefined,
      start: {
        devtools: false,
      },
    }),
  ],
  server: {
    port: 3000,
    // IPv4 bind: `host: true` only listens on :::3000, and Cursor's
    // port forward looks for 0.0.0.0:3000.
    host: "0.0.0.0",
  },
  build: {
    target: "esnext",
    assetsInlineLimit: 0,
  },
  // Keep oxfmt off generated, vendored, and tool-managed files: solid2-agent-kit,
  // Convex ai-files, and fallow own theirs (some byte-stable), and the Japanese
  // migration guide is vendored as-is per AGENTS.md.
  fmt: {
    ignorePatterns: [
      "convex/_generated/**",
      "spacetimedb/bindings/**",
      ".github/workflows/**",
      "docs/solid2-migration-from-react-ja.md",
      ".claude/**",
      ".cursor/**",
      ".agents/**",
      ".deepsec/**",
      ".mcp.json",
      "CLAUDE.md",
      "AGENTS.md",
    ],
  },
  lint: {
    ignorePatterns: ["convex/_generated/**", "spacetimedb/bindings/**", ".deepsec/**"],
    // Tailwind vocabulary (ADR 0012): reads src/theme.css and fails on any
    // class the theme does not define, with a "Did you mean" repair in the
    // message. Not officially Solid-aware — it reads `class` the way it reads
    // Vue's — so scripts/shadcn-lint.test.ts pins the forms this repo writes.
    // Convex's own rules (https://docs.convex.dev/eslint), run through Oxlint
    // as its docs describe. Every rule is listed and every one is `error`,
    // including the three the plugin's `recommended` leaves off or at `warn`:
    // `require-access-control` (each public function calls a `require*` /
    // `check*` / `can*` guard at the top of its handler — the deliberate
    // public reads say why on an oxlint-disable line), `no-filter-in-query`,
    // and `import-wrong-runtime` (no "use node" file yet; it guards the first).
    // Oxlint gives JS plugins no type information, so `explicit-table-ids` and
    // `no-collect-in-query` run on syntax alone: they still report, without
    // autofixes, and `no-collect-in-query` cannot tell a query from a
    // mutation or a test, so it applies to all three: bounded sets are read
    // with `.take(bound)`.
    jsPlugins: ["@shadcn/lint", "@convex-dev/eslint-plugin"],
    overrides: [
      {
        files: ["convex/**/*.ts"],
        rules: {
          "@convex-dev/no-old-registered-function-syntax": "error",
          "@convex-dev/require-args-validator": "error",
          "@convex-dev/require-access-control": "error",
          "@convex-dev/import-wrong-runtime": "error",
          "@convex-dev/explicit-table-ids": "error",
          "@convex-dev/no-filter-in-query": "error",
          "@convex-dev/no-collect-in-query": "error",
          "@convex-dev/no-top-of-hour-crons": "error",
          "@convex-dev/no-schema-import-cycle": "error",
          "@convex-dev/no-duplicate-indexes": "error",
          "@convex-dev/no-process-env": "error",
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["**/_generated/server"],
                  importNames: [
                    "query",
                    "mutation",
                    "action",
                    "internalQuery",
                    "internalMutation",
                    "internalAction",
                    "httpAction",
                  ],
                  message:
                    "Only a top-level file in convex/ registers functions (ADR 0020); keep helpers in convex/model and call them from there.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["convex/*.ts"],
        rules: { "no-restricted-imports": "off" },
      },
    ],
    settings: { shadcn: { componentImports: ["^\\.\\.?/"] } },
    rules: {
      "shadcn/no-restyle": ["error", { allow: ["layout"] }],
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-unknown-classes": "error",
      "shadcn/require-static-classes": "error",
      "shadcn/no-inline-styles": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
      denyWarnings: true,
    },
  },
}));
