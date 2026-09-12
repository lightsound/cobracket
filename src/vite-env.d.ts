/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
  /**
   * Set by vitest in every test run, and by nothing else. Read once, in
   * `src/dev-diagnostics.ts`, to stand down from an engine the test harness
   * owns — see the comment there.
   */
  readonly VITEST?: boolean;
}
