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

## Getting started

- https://v2-rebuild--solid-docs-v2.netlify.app/getting-started/quick-start.md
- https://v2-rebuild--solid-docs-v2.netlify.app/getting-started/project-shapes.md

## Concepts

- https://v2-rebuild--solid-docs-v2.netlify.app/concepts/reactivity.md
- https://v2-rebuild--solid-docs-v2.netlify.app/concepts/stores.md
- https://v2-rebuild--solid-docs-v2.netlify.app/concepts/components-and-jsx.md
- https://v2-rebuild--solid-docs-v2.netlify.app/concepts/async-reactivity.md
- https://v2-rebuild--solid-docs-v2.netlify.app/concepts/boundaries.md
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
- https://v2-rebuild--solid-docs-v2.netlify.app/guides/testing.md
- https://v2-rebuild--solid-docs-v2.netlify.app/migration/from-react.md
- https://v2-rebuild--solid-docs-v2.netlify.app/migration/from-solid-1.md
- https://v2-rebuild--solid-docs-v2.netlify.app/migration/from-solid-start.md
- https://v2-rebuild--solid-docs-v2.netlify.app/migration/from-solid-router.md
- https://v2-rebuild--solid-docs-v2.netlify.app/migration/from-solid-meta.md

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
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/advanced/specialized-reactivity/on-cleanup.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-js/advanced/store-advanced/snapshot.md

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
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-web/components/dynamic-component.md
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
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router/navigation.md
- https://v2-rebuild--solid-docs-v2.netlify.app/reference/solid-router/data.md
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
