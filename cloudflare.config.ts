import { defineConfig } from "cf/config";
// fallow-ignore-file coverage-gaps -- read by the cf CLI, never imported, so no test dependency path exists; it is an entry point (see .fallowrc.jsonc)

export default defineConfig({
  worker: {
    name: "cobracket",
    compatibilityDate: "2026-08-31",
    assets: {
      notFoundHandling: "single-page-application",
    },
    observability: {
      enabled: true,
    },
  },
});
