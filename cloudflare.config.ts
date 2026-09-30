import { defineConfig } from "cf/config";

// Static hosting for the client-only build (ADR 0010). There is no `main`:
// the Worker serves assets and nothing else, so every request is a free
// static-asset request and no Worker code runs.
export default defineConfig({
  worker: {
    name: "cobracket",
    compatibilityDate: "2026-08-31",
    assets: {
      // The app is a Solid Router SPA: /t/:tournamentId and /s/:shareSlug
      // exist only client-side. Unmatched paths serve /index.html with
      // 200 OK, which is what makes a Share Link survive a direct visit
      // and a reload.
      notFoundHandling: "single-page-application",
    },
    observability: {
      enabled: true,
    },
  },
});
