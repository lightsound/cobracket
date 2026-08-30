import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Format engine tests are pure TypeScript (Seam 1); node is enough.
    // Seam 2 (convex-test) will add its own edge-runtime environment later.
    include: ["convex/format/**/*.test.ts"],
    environment: "node",
  },
});
