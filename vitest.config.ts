import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Format engine tests are pure TypeScript (Seam 1); node is enough as
    // the default. convex-test files opt into edge-runtime per file via a
    // `// @vitest-environment edge-runtime` pragma.
    include: ["convex/**/*.test.ts"],
    environment: "node",
  },
});
