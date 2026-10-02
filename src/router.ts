import { createRouter, defineRoute } from "@solidjs/router";
import { lazy } from "solid-js";
import { api } from "../convex/_generated/api";
import { prefetchConvexQuery } from "./lib/convex";

// Each page's data starts loading on link intent — hover, focus, touch — a
// round trip before the click, so the page finds its answer in the Convex
// client and shows no fallback. Measured in Chromium against a local
// deployment with 100ms of one-way latency: every page boundary showed its
// fallback for one round trip (200ms) after navigation, and under 150ms of
// latency the same wait reads as a flicker (`[FALLBACK_FLASH]`). A preload
// on `"initial"` intent would gain nothing — the page subscribes on mount
// anyway — and for the two Organizer-gated reads it would run before the
// session is restored, so it is skipped. `prefetchConvexQuery` holds the
// subscription open briefly and releases it at once on failure, so a hover
// while signed out leaves nothing for the page to inherit.
export const Router = createRouter({
  routes: [
    defineRoute({
      path: "/",
      component: lazy(() => import("./pages/Home")),
      preload: ({ intent }) => {
        if (intent !== "initial") prefetchConvexQuery(api.operations.listMyTournaments, {});
      },
    }),
    defineRoute({
      path: "/t/:tournamentId",
      component: lazy(() => import("./pages/Tournament")),
      preload: ({ params, intent }) => {
        if (intent !== "initial") {
          prefetchConvexQuery(api.operations.getTournament, {
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
          prefetchConvexQuery(api.operations.getSharedTournament, { shareSlug: params.shareSlug });
        }
      },
    }),
    { path: "*404", component: lazy(() => import("./pages/NotFound")) },
  ],
});
