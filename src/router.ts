import { createRouter } from "@solidjs/router";
import { lazy } from "solid-js";

// One router instance at module scope (Solid Router 2). URL design:
//   /                 Organizer home: tournament list + creation
//   /t/:tournamentId  Organizer management surface (owner-only reads)
//   /s/:shareSlug     Share Link (stories 21-23): public, view-only,
//                     keyed by the unguessable slug, never the document id
export const Router = createRouter({
  routes: [
    { path: "/", component: lazy(() => import("./pages/Home")) },
    { path: "/t/:tournamentId", component: lazy(() => import("./pages/Tournament")) },
    { path: "/s/:shareSlug", component: lazy(() => import("./pages/Share")) },
    { path: "*404", component: lazy(() => import("./pages/NotFound")) },
  ],
});
