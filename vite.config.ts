import { defineConfig } from "vite-plus";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Turnkey client mode: no index.html and no mount file — the plugin
  // generates the entries around src/App.tsx, wrapped in src/Document.tsx
  // (or a built-in shell). `vite build` prerenders the shell into
  // dist/client/index.html and emits a purely static dist/client.
  plugins: [
    tailwindcss(),
    solid({
      // Dev-serve only: injects `@solidjs/diagnostics`' in-page bridge and
      // serves /__solid/diagnostics, so an agent can drive a capture with
      // curl (begin / interact / costs / end) instead of instrumenting the
      // app. Never active on builds, preview, or under vitest.
      //
      // The dev dependency alone auto-enables this. It is spelled out anyway
      // because nothing imports the package: fallow reports it as an unused
      // devDependency and offers "remove" as an auto-fix, so this line is
      // where a reader finds out what the dependency is for. Note it is only
      // a signpost — next.43 still starts and still prints the endpoint when
      // the package is absent, despite what the option's docs say.
      diagnostics: true,
      start: {
        // Optional peer `@solidjs/start-devtools` is not installed.
        // next.32+ treats Vite's optional-peer stub as missing, but keep
        // this off unless that package is actually a dependency.
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
    // Keep images as asset files instead of inlining them into the JS bundle.
    assetsInlineLimit: 0,
  },
  // Keep oxfmt off generated, vendored, and tool-managed files: solid2-agent-kit,
  // Convex ai-files, and fallow own theirs (some byte-stable), and the Japanese
  // migration guide is vendored as-is per AGENTS.md.
  fmt: {
    ignorePatterns: [
      "convex/_generated/**",
      ".github/workflows/**",
      "docs/solid2-migration-from-react-ja.md",
      ".claude/**",
      ".cursor/**",
      ".agents/**",
      ".mcp.json",
      "CLAUDE.md",
      "AGENTS.md",
    ],
  },
  lint: {
    ignorePatterns: ["convex/_generated/**"],
    // Full type-aware path: `vp check` also runs TypeScript type checks
    // (tsgolint), alongside the project's `bun x tsc --noEmit`.
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
