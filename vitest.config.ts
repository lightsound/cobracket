import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // The environment split is named once here, not per file: format engine
    // tests are pure TypeScript (Seam 1) and run under node; convex-test
    // files (auth, and Seam 2 to come) need edge-runtime. A new convex test
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
        test: {
          name: "convex",
          include: ["convex/**/*.test.ts"],
          exclude: ["convex/format/**"],
          environment: "edge-runtime",
        },
      },
    ],
  },
});
