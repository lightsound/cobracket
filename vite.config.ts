import { defineConfig } from "vite-plus";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

// A function so the one mode-dependent setting below can read `mode`; every
// other setting is the same in every mode.
export default defineConfig(({ mode }) => ({
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
      // The dev dependency alone auto-enables this; the option is spelled
      // out so a reader finds the dev-server half of the package next to the
      // plugin that serves it (src/test-setup.ts is the other half — that one
      // imports it, which is why it no longer needs a fallow ignore). Note
      // this line is only a signpost — next.44 still starts and still prints
      // the endpoint when the package is absent, despite what the option's
      // docs say.
      diagnostics: true,
      // `bun run test:e2e` serves the app with `--mode e2e`, and the one
      // thing that mode changes is the solid-refresh HMR transform. Its
      // wrapper around every component declaration is a reactive source, so
      // a list's insert effect subscribes to one node per component row and a
      // 30+ row list reports [WIDE_SCOPE_DEPS] in `bun dev` with every source
      // named `[solid-refresh]<Component>` — measured on the 31-match bracket
      // the browser gate renders: 31 sources, all wrappers, on code the gate
      // must pass. The vitest `src` project turns the transform off for the
      // same reason (vitest.config.ts); here it stays on for `bun dev`, where
      // HMR is the point, and off for the gate, which measures the graph the
      // app ships. Nothing else about the e2e server differs from `bun dev`.
      refresh: mode === "e2e" ? { disabled: true } : undefined,
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
}));
