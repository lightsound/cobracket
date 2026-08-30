# Vitest is the single test runner

All tests in this repo run under Vitest (`bun run test`), including the pure format-engine tests that previously ran under `bun test`. The deciding constraint is Seam 2 of the MVP testing plan: operations-API tests use `convex-test`, which requires Vitest (`import.meta.glob` for module discovery and the `@edge-runtime/vm` environment). Running two test runners for one small codebase would split configuration, watch modes, and CI reporting for no benefit, so the existing tests moved to Vitest instead. Vitest also shares Vite's transform pipeline, so tests and the build see modules the same way. Bun remains the package manager and script runner — only the test runner changed.

## Considered Options

Keep `bun test` for the pure format engine and add Vitest only for Seam 2: preserves Bun's fast startup for unit tests, but permanently maintains two runners with different assertion nuances, config files, and CI steps. Rejected — the startup difference is noise at this codebase's size, and one runner keeps the testing story uniform.
