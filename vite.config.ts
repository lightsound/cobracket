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
  // Keep oxfmt off generated, vendored, and tool-managed files: solid2-agent-kit
  // and fallow own theirs (some byte-stable), and the Japanese
  // migration guide is vendored as-is per AGENTS.md.
  fmt: {
    ignorePatterns: [
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
    ignorePatterns: ["spacetimedb/bindings/**", ".deepsec/**"],
    // Tailwind vocabulary (ADR 0012): reads src/theme.css and fails on any
    // class the theme does not define, with a "Did you mean" repair in the
    // message. Not officially Solid-aware — it reads `class` the way it reads
    // Vue's — so scripts/shadcn-lint.test.ts pins the forms this repo writes.
    jsPlugins: ["@shadcn/lint"],
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
