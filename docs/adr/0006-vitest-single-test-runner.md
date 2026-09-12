# Vitest is the single test runner

All tests in this repo run under Vitest (`bun run test`), including the pure format-engine tests that previously ran under `bun test`. The deciding constraint is Seam 2 of the MVP testing plan: operations-API tests use `convex-test`, which requires Vitest (`import.meta.glob` for module discovery and the `@edge-runtime/vm` environment). Running two test runners for one small codebase would split configuration, watch modes, and CI reporting for no benefit, so the existing tests moved to Vitest instead. Vitest also shares Vite's transform pipeline, so tests and the build see modules the same way. Bun remains the package manager and script runner — only the test runner changed.

## Considered Options

Keep `bun test` for the pure format engine and add Vitest only for Seam 2: preserves Bun's fast startup for unit tests, but permanently maintains two runners with different assertion nuances, config files, and CI steps. Rejected — the startup difference is noise at this codebase's size, and one runner keeps the testing story uniform.

## Amendment: the browser gate stays inside Vitest

The real-browser diagnostics gate (`e2e/`) drives Chromium, which is what `@playwright/test` is for — and it is not used. `playwright-core` is a library here, the driver behind `@solidjs/diagnostics`' `captureBrowserArtifact`; the test itself is a Vitest project (`e2e`) with a global setup that boots the servers, and its verdict is the same `assertGate` the happy-dom tests use. A second runner would have meant a second config, a second reporter in CI, and two places for the same assertion to drift apart. Two consequences follow. `bun run test` excludes the `e2e` project (`--project '!e2e'`), because it needs a browser and a backend that a unit run should not wait for; `bun run test:e2e` selects it. And `bun run verify` does not include it either, for the same reason, so CI runs it as an independent job rather than a step of `verify` — the gate list in `package.json` stays the seconds-fast, deterministic set, and the browser gate is the one check that sits beside it.
