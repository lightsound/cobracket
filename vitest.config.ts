import { configDefaults, defineConfig } from "vite-plus";
import solid from "@solidjs/vite-plugin";
import { spacetimedbModuleTestPlugin } from "spacetimedb/server/test-utils/vitest";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "format",
          include: ["spacetimedb/format/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        plugins: [solid({ refresh: false })],
        test: {
          name: "src",
          // Both extensions, one environment, one setup: a reactive test
          // written without JSX must not be able to opt out of either by
          // being named .test.ts.
          include: ["src/**/*.test.{ts,tsx}"],
          // `.ssr.test.tsx` belongs to the project below and matches this
          // pattern too. Extend the defaults (node_modules, dist, ...) — a
          // bare exclude would replace them.
          exclude: [...configDefaults.exclude, "src/**/*.ssr.test.tsx"],
          // Why happy-dom, not node: docs/diagnostics-gates.md, Why the environments differ.
          environment: "happy-dom",
          setupFiles: ["./src/test-setup.ts"],
        },
      },
      {
        plugins: [solid()],
        test: {
          name: "ssr",
          include: ["src/**/*.ssr.test.tsx"],
          environment: "node",
        },
      },
      {
        test: {
          name: "scripts",
          include: ["scripts/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "e2e",
          include: ["e2e/**/*.test.ts"],
          environment: "node",
          globalSetup: ["./e2e/global-setup.ts"],
          // A whole Organizer session in a browser, not a unit: one test is
          // seconds, and the setup can be minutes on a cold container (the
          // SpacetimeDB standalone downloads on first use).
          testTimeout: 60_000,
          hookTimeout: 300_000,
        },
      },
      {
        test: {
          name: "convex",
          include: ["convex/**/*.test.ts"],
          // Extend the defaults (node_modules, dist, ...) — a bare exclude
          // would replace them.
          exclude: [...configDefaults.exclude],
          environment: "edge-runtime",
        },
      },
      {
        // The SpacetimeDB module (spacetimedb/): its official test
        // harness runs the real module against a portable in-process
        // datastore. The plugin makes `spacetimedb/server` importable
        // under Vitest — the real entry loads the host-only
        // `spacetime:sys` module — and backs it with that datastore.
        // Sender identities in tests derive from test-auth JWT
        // payloads (see spacetimedb/test/harness.ts).
        plugins: [spacetimedbModuleTestPlugin()],
        test: {
          name: "spacetimedb",
          include: ["spacetimedb/test/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // The connection-level suite (spacetimedb/connection/): a real
        // standalone booted by the global setup, the committed module
        // published to it, and wire-level gating proofs through the
        // committed bindings — the half of the migration's parity
        // claim the in-process harness cannot make. It boots a server
        // binary, so like `e2e` it is not part of `bun run test`;
        // `bun run test:connection` selects it, and CI gives it its
        // own job.
        test: {
          name: "connection",
          include: ["spacetimedb/connection/**/*.test.ts"],
          environment: "node",
          globalSetup: ["./spacetimedb/connection/global-setup.ts"],
          // Whole connection rounds against a local server: seconds,
          // not milliseconds; the setup publishes a module and can
          // download the server binary on a cold cache.
          testTimeout: 120_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});
