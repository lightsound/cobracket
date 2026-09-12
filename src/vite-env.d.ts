/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
  /**
   * Set by vitest in every test run, and by nothing else. Read once, in
   * `src/dev-diagnostics.ts`, to stand down from an engine the test harness
   * owns — see the comment there.
   *
   * A **string**: vitest rewrites `import.meta.env` to `process.env` and sets
   * `VITEST="true"`, so the guard is a truthiness check and `=== true` would
   * never match.
   */
  readonly VITEST?: string;
}
