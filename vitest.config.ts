import { configDefaults, defineConfig } from "vite-plus";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  test: {
    // The environment split is named once here, not per file: format engine
    // tests are pure TypeScript (Seam 1) and run under node; convex-test
    // files (auth, and Seam 2 to come) need edge-runtime; everything under
    // src/ needs happy-dom, because that is what makes Solid resolve its
    // browser build and the diagnostics gate below mean anything. A new test
    // file lands in the right environment without remembering a pragma.
    projects: [
      {
        test: {
          name: "format",
          include: ["convex/format/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // The JSX transform: vitest.config.ts replaces vite.config.ts rather
        // than extending it, so the plugin has to be named again here. The
        // app's `diagnostics` / `start` settings are dev-server concerns the
        // plugin skips under vitest, so they are left out.
        //
        // `refresh` is the one option a test run needs an opinion about.
        // solid-refresh wraps every component declaration in a memo so HMR can
        // re-run it, and that wrapper is a reactive source: a list's insert
        // effect then subscribes to one node per row (measured at 40 rows: 0
        // sources for plain element rows, 1 per component row, 2 with a per-row
        // `<Show>` as well). Attribution counts those wrappers, so a 31-match
        // bracket reported [WIDE_SCOPE_DEPS] — 31 sources, every one of them
        // `[solid-refresh]MatchCard`. Nothing of that exists in a production
        // build, and tests have no HMR to serve, so the transform is off here
        // and the gate measures the graph the app actually ships.
        plugins: [solid({ refresh: { disabled: true } })],
        test: {
          name: "src",
          // Both extensions, one environment, one setup: a reactive test
          // written without JSX must not be able to opt out of either by
          // being named .test.ts.
          include: ["src/**/*.test.{ts,tsx}"],
          // Not for the DOM alone — the `node` condition resolves Solid's
          // server build, where writes are inert and attribution sees
          // nothing. See src/test-setup.ts.
          environment: "happy-dom",
          // Fails any test that produced a Solid diagnostic or left a hold
          // unacknowledged.
          setupFiles: ["./src/test-setup.ts"],
        },
      },
      {
        test: {
          // Repo scripts. They run under Bun, so their tests drive them as a
          // subprocess (the `bun` on PATH) and need nothing from the
          // environment themselves.
          name: "scripts",
          include: ["scripts/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "convex",
          include: ["convex/**/*.test.ts"],
          // Extend the defaults (node_modules, dist, ...) — a bare exclude
          // would replace them.
          exclude: [...configDefaults.exclude, "convex/format/**"],
          environment: "edge-runtime",
        },
      },
    ],
  },
});
