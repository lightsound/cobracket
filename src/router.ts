import { createRouter, defineRoute, intentPreload, pendingLinks } from "@solidjs/router";
import { lazy } from "solid-js";
import { api } from "./lib/operations";
import { prefetchBackendQuery } from "./lib/backend";

export const Router = createRouter({
  links: pendingLinks,
  preloadLinks: intentPreload(),
  routes: [
    defineRoute({
      path: "/",
      component: lazy(() => import("./pages/Home")),
      preload: ({ intent }) => {
        if (intent !== "initial") prefetchBackendQuery(api.tournaments.listMyTournaments, {});
      },
    }),
    defineRoute({
      path: "/t/:tournamentId",
      component: lazy(() => import("./pages/Tournament")),
      preload: ({ params, intent }) => {
        if (intent !== "initial") {
          prefetchBackendQuery(api.tournaments.getTournament, {
            tournamentId: params.tournamentId,
          });
        }
      },
    }),
    defineRoute({
      path: "/s/:shareSlug",
      component: lazy(() => import("./pages/Share")),
      preload: ({ params, intent }) => {
        if (intent !== "initial") {
          prefetchBackendQuery(api.share.getSharedTournament, { shareSlug: params.shareSlug });
        }
      },
    }),
    { path: "*404", component: lazy(() => import("./pages/NotFound")) },
  ],
});
