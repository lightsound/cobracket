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
      // imports it, which is why it no longer needs a fallow ignore). Since
      // next.47 `true` also fails the dev server loudly if the package goes
      // missing (next.44 started anyway and printed the endpoint), so the
      // line is a declared dependency as well as a signpost.
      diagnostics: true,
      // `bun run test:e2e` serves the app with `--mode e2e`, and that mode
      // changes three things: the two dev-only injections below, and the
      // app's own attribution hold (`src/dev-diagnostics.ts` stands down so
      // the gate's capture owns the engine). First, the solid-refresh HMR
      // transform. Its
      // wrapper around every component declaration is a reactive source, so
      // a list's insert effect subscribes to one node per component row and a
      // 30+ row list reports [WIDE_SCOPE_DEPS] in `bun dev` with every source
      // named `[solid-refresh]<Component>` — measured on the 31-match bracket
      // the browser gate renders: 31 sources, all wrappers, on code the gate
      // must pass. The vitest `src` project turns the transform off for the
      // same reason (vitest.config.ts); here it stays on for `bun dev`, where
      // HMR is the point, and off for the gate, which measures the graph the
      // app ships.
      refresh: mode === "e2e" ? { disabled: true } : undefined,
      // Same reasoning, second dev-only transform. Since next.47 the dev
      // server injects `@solidjs/web/performance-tracks` ahead of the app
      // entry, which paints every record the engine emits — each re-run,
      // node creation, effect, flush and flight — onto the Chrome
      // Performance panel as it happens. That painting runs inside the
      // scopes the gate times: measured on the browser gate, the `<Show>`
      // that instantiates the management page and the roster's `<For>` went
      // from under the 8ms `[HOT_SCOPE_TIME]` budget to 13.8ms and 14.2ms
      // with the tracks on, and back under it with them off, on the same
      // code and the same container. Tracks stay on for `bun dev`, where a
      // human reads them; the gate measures the app, not the devtools.
      performanceTracks: mode === "e2e" ? false : undefined,
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
    // Tailwind vocabulary (ADR 0012): reads src/theme.css and fails on any
    // class the theme does not define, with a "Did you mean" repair in the
    // message. Not officially Solid-aware — it reads `class` the way it reads
    // Vue's — so scripts/shadcn-lint.test.ts pins the forms this repo writes.
    jsPlugins: ["@shadcn/lint"],
    // Every component this repo imports by relative path is one of its own,
    // so each is guarded by `no-restyle` from the day it exists: callers may
    // place a component (layout), never restyle it.
    settings: { shadcn: { componentImports: ["^\\.\\.?/"] } },
    rules: {
      "shadcn/no-restyle": ["error", { allow: ["layout"] }],
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-unknown-classes": "error",
      "shadcn/require-static-classes": "error",
      // Only src/bracket may carry `style` at all (lint:theme), and there it
      // may set custom properties only; classes decide what they style.
      "shadcn/no-inline-styles": "error",
    },
    // Full type-aware path: `vp check` also runs TypeScript type checks
    // (tsgolint), alongside the project's `bun x tsc --noEmit`.
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
}));
