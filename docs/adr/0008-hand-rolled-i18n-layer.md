# Hand-roll the i18n layer instead of adopting an i18n library

Story 24 requires every UI string to go through an i18n layer from the first screen, English first with Japanese provided. We hand-roll that layer in `src/i18n/`: the English dictionary is the source of truth (its keys define `MessageKey`), the Japanese dictionary is typed `Record<MessageKey, string>` so the two cannot drift, and `t(key, params?)` reads a module-level locale signal so every JSX read re-renders on locale change — the Solid 2 model for app-wide singletons. The locale persists to `localStorage` following the `theme-preference.ts` pattern.

## Considered Options

- **Paraglide JS (inlang)** — the strongest library candidate: compiled per-message functions, typed parameters, tree-shaking, CLDR plural variants, and translation tooling for non-developers. Deferred, not rejected. The deciding constraint is Solid 2.0: Paraglide's message functions are not reactive; locale switching relies on a framework adapter re-rendering the tree, and Solid 2 has no re-render — an adapter would have to route every message read through a locale signal, which is exactly the ~70 lines the hand-rolled layer already is. No Solid 2 adapter exists (existing ones target React/Svelte/SolidStart 1.x, and Solid 2 is incompatible with 1.x). At the MVP's scale (~90 keys x 2 locales) the library's remaining advantages don't bite, while its compiler step would add generated output for every gate (oxfmt, oxlint, fallow, ImportLint) to ignore.
- **Runtime libraries (i18next and similar)** — heavier runtime, own reactivity/stores that fight the Solid 2 model, and no compile-time key typing without extra codegen. Rejected.

## Consequences

- The public surface is deliberately tiny — `t`, `locale`, `setLocale`, `Locale`, `MessageKey`, enforced by ImportLint — and dictionaries are flat keys, so a later migration to Paraglide is mechanical (messages move to inlang files; `t()` becomes a wrapper or call sites move to `m.*`).
- Known limitations accepted for MVP: placeholders are untyped (a `{name}` typo surfaces at runtime, mitigated by keys living in one reviewed module) and pluralization is naive (English copes with "result(s)"; Japanese needs no plural forms).
- Revisit when any of these becomes true: translations are opened to non-developers (inlang editor/CAT tooling starts to matter), locale or key count grows enough that per-locale splitting and tree-shaking matter, or typed parameters / CLDR plural rules become necessary — or when a maintained Paraglide adapter for Solid 2 appears.
