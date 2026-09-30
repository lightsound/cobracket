import { defineWranglerConfig } from "wrangler/experimental-config";

// cf delegates builds and the dev server to the installed wrangler, which
// reads this file for build-time fields. Worker settings live in
// cloudflare.config.ts. This is why `wrangler` remains a devDependency.
export default defineWranglerConfig({
  types: {
    generate: false,
  },
  // `bun run build` emits a purely static dist/client. dist/server is also
  // emitted by the Solid start plugin but is not part of the deployment.
  assetsDirectory: "./dist/client",
});
