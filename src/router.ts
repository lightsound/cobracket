import { createRouter } from "@solidjs/router";
import { lazy } from "solid-js";

export const Router = createRouter({
  routes: [
    { path: "/", component: lazy(() => import("./pages/Home")) },
    { path: "/t/:tournamentId", component: lazy(() => import("./pages/Tournament")) },
    { path: "/s/:shareSlug", component: lazy(() => import("./pages/Share")) },
    { path: "*404", component: lazy(() => import("./pages/NotFound")) },
  ],
});
