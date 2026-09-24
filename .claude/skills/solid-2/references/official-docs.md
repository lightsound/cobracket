# Solid 2.0 official documentation — fetchable URLs

Canonical site: https://v2.solidjs.com/ (Cloudflare-protected; blocks non-browser fetchers).
Agent-friendly mirror (same content, plain markdown): `https://v2-rebuild--solid-docs-v2.netlify.app`

- Full index: https://v2-rebuild--solid-docs-v2.netlify.app/llms.txt
- Single-file corpus: https://v2-rebuild--solid-docs-v2.netlify.app/llms-full.txt
- Any docs path works with a `.md` suffix.

Only trust these Solid 2.0 sources. Solid 1.x docs (docs.solidjs.com) do not apply.

This list is curated for agent work: core TSX first, then the app-stack pages that
exist when a project has routing, server functions, or document head tags.
It is not every Advanced reference page. When an API is missing here, look it up
in `llms.txt` rather than guessing from Solid 1.x or React.

## Read before using

The skill does not cover these; fetch the pages when the task needs them.

- Filesystem routing (`fileRoutes({ types: true })` from `filesystem-routing/vite`, `[id]` / `[[p]]` / `[...rest]` / `(group)/` names, `defineFileRoute`): https://v2-rebuild--solid-docs-v2.netlify.app/reference/filesystem-routing.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/filesystem-routing/vite.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/filesystem-routing/conventions.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/filesystem-routing/manifest.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router/filesystem.md
- A route array in its own file (`defineRoutes`, `RouteProps<typeof Router.paths.x>`, `matchFilters`): https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router/router-factory.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router/routes-and-paths.md
- Layout routes, pathless routes, where router hooks may run: https://v2-rebuild--solid-docs-v2.netlify.app/routing/solid-router/nested-routes.md
- Auth guards and redirect-after-sign-in (`next` validation): https://v2-rebuild--solid-docs-v2.netlify.app/guides/protected-routes.md
- Unsaved-changes guard (`useBeforeLeave`): https://v2-rebuild--solid-docs-v2.netlify.app/routing/solid-router/navigation.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router/navigation.md
- Row selection without `createSelector` (id-keyed projection): https://v2-rebuild--solid-docs-v2.netlify.app/guides/lists.md, https://v2-rebuild--solid-docs-v2.netlify.app/guides/performance.md
- Infinite scroll, polling, sharing one request: https://v2-rebuild--solid-docs-v2.netlify.app/guides/data-fetching-patterns.md
- Writing a custom primitive (called under an owner, `MaybeAccessor`, `getOwner` / `runWithOwner` / `isDisposed` after async): https://v2-rebuild--solid-docs-v2.netlify.app/guides/custom-primitives.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/advanced/owner-introspection/get-owner.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/advanced/owner-introspection/run-with-owner.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/advanced/owner-introspection/is-disposed.md
- Wrapping a non-Solid library, push feeds with a reactive argument, web components (`prop:`, event names): https://v2-rebuild--solid-docs-v2.netlify.app/guides/integrate-non-solid-code.md
- Typed env (`env.ts` schema, `VITE_` client keys), `import "server-only"`, what compiles `"use server"`: https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/environment.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/vite-plugin-solid/modules.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/vite-plugin-solid/server-functions.md
- Sessions and cookies (`parseCookieHeader` / `serializeCookie`, `RequestEventLocals` typing, when a cookie write commits): https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/sessions-and-auth.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/request-response/cookies.md
- Middleware chains and API routes / webhooks (`createAPIHandler`, `httpMethods: true`): https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/middleware-and-api-routes.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/filesystem-routing/api.md
- Auth headers for every call, per-call `signal` / `keepalive` (`configureServerFunctionsClient`, `invoke`): https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/server-functions/metadata-and-transport.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/server-functions/configure-client.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/server-functions/invoke.md
- Server-function limits (`bodySizeLimit`, `maxArguments`): https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/server-functions/host-configuration.md
- Static prerendering (`prerender-crawler/vite`, `prerendered()`), choosing client / SSR / prerender: https://v2-rebuild--solid-docs-v2.netlify.app/guides/choose-a-rendering-mode.md
- SSR-safe code (what runs on the server, hydration mismatches): https://v2-rebuild--solid-docs-v2.netlify.app/guides/ssr-safe-code.md
- Type helpers (`VoidProps`, `FlowProps`, `ComponentProps<"button">`, `JSX.EventHandler`, generic `<T,>` components): https://v2-rebuild--solid-docs-v2.netlify.app/guides/typescript.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/types/component-types.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/types/reactive-types.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/types/jsx-types.md
- Head tag identity (OG `property`, `key`, layout `<Head>` groups): https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/head-and-metadata.md
- Server-side tests (`createRequestEvent`, `provideRequestEvent` from `@solidjs/web/storage`, a Node Vitest project): https://v2-rebuild--solid-docs-v2.netlify.app/guides/testing.md, https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/request-response/provide-request-event.md
- Migrating 1.x data fetching (`createResource`, `resource.latest`): https://v2-rebuild--solid-docs-v2.netlify.app/migration/data-fetching-from-solid-1.md
- Terms used across the docs: https://v2-rebuild--solid-docs-v2.netlify.app/glossary.md; the mental model: https://v2-rebuild--solid-docs-v2.netlify.app/guides/thinking-in-solid.md

## Getting started

- https://v2-rebuild--solid-docs-v2.netlify.app/getting-started/quick-start.md
- https://v2-rebuild--solid-docs-v2.netlify.app/getting-started/project-shapes.md

## Concepts

- https://v2-rebuild--solid-docs-v2.netlify.app/concepts/reactivity.md
- https://v2-rebuild--solid-docs-v2.netlify.app/concepts/stores.md
- https://v2-rebuild--solid-docs-v2.netlify.app/concepts/components-and-jsx.md
- https://v2-rebuild--solid-docs-v2.netlify.app/concepts/async-reactivity.md
- https://v2-rebuild--solid-docs-v2.netlify.app/concepts/boundaries.md
- https://v2-rebuild--solid-docs-v2.netlify.app/concepts/mutations.md
- https://v2-rebuild--solid-docs-v2.netlify.app/concepts/rendering-and-ssr.md

## Building apps (start mode / fullstack)

Use these when the project has `@solidjs/vite-plugin` start mode, SSR, or server
functions. Do not invent Next.js / SolidStart 1.x equivalents.

- https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/app-structure.md
- https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/styling-and-assets.md
- https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/head-and-metadata.md
- https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/server-functions.md
- https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/server-functions/reads-and-live-data.md
- https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/server-functions/arguments-and-security.md
- https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/server-functions/mutations-and-responses.md
- https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/server-functions/metadata-and-transport.md
- https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/server-functions/progressive-enhancement.md
- https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/sessions-and-auth.md
- https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/environment.md
- https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/middleware-and-api-routes.md
- https://v2-rebuild--solid-docs-v2.netlify.app/building-apps/deployment.md

## Routing

Routing is optional. If `@solidjs/router` or TanStack Router is in the project,
read these before writing route JSX.

- https://v2-rebuild--solid-docs-v2.netlify.app/routing/overview.md
- https://v2-rebuild--solid-docs-v2.netlify.app/routing/solid-router.md
- https://v2-rebuild--solid-docs-v2.netlify.app/routing/solid-router/setup.md
- https://v2-rebuild--solid-docs-v2.netlify.app/routing/solid-router/route-definitions.md
- https://v2-rebuild--solid-docs-v2.netlify.app/routing/solid-router/nested-routes.md
- https://v2-rebuild--solid-docs-v2.netlify.app/routing/solid-router/navigation.md
- https://v2-rebuild--solid-docs-v2.netlify.app/routing/solid-router/data.md
- https://v2-rebuild--solid-docs-v2.netlify.app/routing/solid-router/server-rendering.md
- https://v2-rebuild--solid-docs-v2.netlify.app/routing/tanstack.md

## Guides and migration

- https://v2-rebuild--solid-docs-v2.netlify.app/guides/avoid-unnecessary-effects.md
- https://v2-rebuild--solid-docs-v2.netlify.app/guides/state-management.md
- https://v2-rebuild--solid-docs-v2.netlify.app/guides/debugging-reactivity.md
- https://v2-rebuild--solid-docs-v2.netlify.app/guides/performance.md
- https://v2-rebuild--solid-docs-v2.netlify.app/guides/observability.md
- https://v2-rebuild--solid-docs-v2.netlify.app/guides/observability-adapters.md
- https://v2-rebuild--solid-docs-v2.netlify.app/guides/lists.md
- https://v2-rebuild--solid-docs-v2.netlify.app/guides/data-fetching-patterns.md
- https://v2-rebuild--solid-docs-v2.netlify.app/guides/forms.md
- https://v2-rebuild--solid-docs-v2.netlify.app/guides/testing.md
- https://v2-rebuild--solid-docs-v2.netlify.app/migration/from-react.md
- https://v2-rebuild--solid-docs-v2.netlify.app/migration/from-solid-1.md
- https://v2-rebuild--solid-docs-v2.netlify.app/migration/from-solid-start.md
- https://v2-rebuild--solid-docs-v2.netlify.app/migration/from-solid-router.md
- https://v2-rebuild--solid-docs-v2.netlify.app/migration/from-solid-meta.md

## Design posts (Solid 2 async model)

Official Solid 2 blog series. Use these for *why* the colorless/async graph works;
verify API names against the reference pages above.

- https://www.solidjs.com/blog/solid-2-0-rc-the-big-reveal
- https://www.solidjs.com/blog/async-solid-fetch-high-block-low
- https://www.solidjs.com/blog/async-solid-write-sync-run-async
- https://www.solidjs.com/blog/async-solid-one-graph-two-machines

## Reference: reactivity (solid-js)

- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/reactivity/create-signal.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/reactivity/create-memo.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/reactivity/create-effect.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/reactivity/create-optimistic.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/reactivity/flush.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/reactivity/is-pending.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/reactivity/latest.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/reactivity/untrack.md

## Reference: stores (solid-js)

- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/stores/create-store.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/stores/create-optimistic-store.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/stores/create-projection.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/stores/reconcile.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/stores/merge.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/stores/omit.md

## Reference: lifecycle and actions (solid-js)

- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/lifecycle-actions/action.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/lifecycle-actions/affects.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/lifecycle-actions/on-settled.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/lifecycle-actions/refresh.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/lifecycle-actions/until.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/advanced/specialized-reactivity/on-cleanup.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/advanced/store-advanced/snapshot.md

## Reference: diagnostics, attribution, and observability

`DEV` is dev builds only; `OBSERVE` and attribution exist on observe and dev builds;
the error hooks fire on every build.

- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/advanced/diagnostics-dev-hooks/dev.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/advanced/diagnostics-dev-hooks/observe.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/advanced/diagnostics-dev-hooks/attribution.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/advanced/diagnostics-dev-hooks/configure-client-errors.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/request-response/configure-server-errors.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/request-response/get-trace-context.md

## Reference: components and JSX (solid-js)

- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/components-jsx/show.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/components-jsx/for.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/components-jsx/repeat.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/components-jsx/loading.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/components-jsx/errored.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/components-jsx/reveal.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/components-jsx/switch-and-match.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/components-context/create-context.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/components-context/use-context.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/components-context/children.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/components-context/lazy.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/components-context/create-unique-id.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/advanced/manual-hydration/no-hydration.md

## Reference: @solidjs/web

- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/rendering-ssr/render.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/rendering-ssr/hydrate.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/rendering-ssr/render-to-string.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/rendering-ssr/render-to-stream.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/rendering-ssr/is-server.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/rendering-ssr/is-dev.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/rendering-ssr/client-only.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/rendering-ssr/http-status.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/rendering-ssr/http-header.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/head/use-head.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/components/portal.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/components/dynamic.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/jsx-properties/ref.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/jsx-properties/class.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/jsx-properties/style.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/jsx-properties/text-content.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/jsx-properties/inner-html.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/server-functions.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/server-functions/get.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/server-functions/rich-arguments.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/request-response.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/request-response/get-request-event.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/request-response/redirect.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/request-response/reload.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/request-response/respond.md

## Reference: @solidjs/router, @solidjs/meta, @solidjs/vite-plugin

- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router/router-factory.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router/routes-and-paths.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router/navigation.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router/data.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router/types.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router/history.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router/filesystem.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-meta/title.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-meta/meta.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-meta/link.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-meta/script.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-meta/head.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/vite-plugin-solid.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/vite-plugin-solid/options.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/vite-plugin-solid/start.md
