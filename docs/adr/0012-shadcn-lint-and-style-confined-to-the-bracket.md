# Check the Tailwind vocabulary with @shadcn/lint; confine `style` to the Bracket

ADR 0007 closed the color vocabulary (`--color-*: initial`, semantic tokens only) and gave `lint:theme` two regexes to guard it. That left the failure agents actually produce unguarded: a class Tailwind does not know generates no CSS and no error. `text-ink-mute` for `text-ink-muted`, `bg-red-500` from muscle memory, `items-cente` — each compiles, typechecks, passes every gate, and silently renders nothing. We adopt `@shadcn/lint` in `vp check` (Oxlint's JS plugin loader, `lint.jsPlugins` in `vite.config.ts`) because it reads `src/theme.css` and answers exactly that question, with the repair in the message ("Did you mean `text-ink-muted`?", the list of declared colors, the on-scale value for `p-[13px]`) — which is what an agent needs to fix a finding in one step.

Enabled as errors: `no-raw-colors`, `no-arbitrary-values`, `no-unknown-classes`, `require-static-classes`, `no-inline-styles`. `no-restyle` stays off: it guards shared components against class overrides, and this repo has none yet; enabled with nothing to recognize it would pass by not running. Turn it on, with contracts, when the first shared component (the page-local `rowButton` / `secondaryButton` / `fieldClass` strings are the candidates) is extracted.

`style` is banned outside `src/bracket` (`lint:theme`), and inside it `no-inline-styles` limits it to custom properties. The attribute has two uses: styling, which classes already cover, and handing runtime values to CSS, which classes cannot — Tailwind emits CSS only for class names written literally in source. The only runtime geometry in the app is the Bracket's (card coordinates from `layoutBracket`, pan and zoom from pointer input), so that is the only place allowed to carry `style`, and there it sets values (`--card-x`) while classes decide what they style (`translate-x-(--card-x)`). Banning the attribute rather than its properties also closes the route that `no-inline-styles` alone would open: `p-(--gap)` is valid Tailwind, but it styles nothing unless some `style` sets `--gap`.

The split between the two tools is by the question each asks. `@shadcn/lint` answers the general one — is this class real, and does it use the theme. `lint:theme` keeps only the bans that follow from this repo's own decisions and are valid Tailwind, so no general tool can see them: `dark:` variants (ADR 0007) and `style` outside the Bracket. Its arbitrary-color rule is removed as a duplicate.

## Considered Options

- **Extend `lint:theme` to resolve every class through Tailwind's compiler.** Answers the same question without a dependency, but reimplements candidate extraction (arrays, objects, templates, constants) that the plugin already does, and without the repair suggestions.
- **Oxlint's `react/forbid-dom-props` for the `style` ban.** It works on Solid JSX, but enabling the `react` plugin turns on its correctness rules too, and those misread Solid: measured, two `react(immutability)` findings on `src/pages/Tournament.tsx`. A React-assuming analyzer is what the repo already refuses in `eslint-plugin-solid`.
- **The ESLint build of the plugin.** Needs ESLint and `@typescript-eslint/parser` beside Vite+'s Oxlint: a second runner and parser for one plugin. The Oxlint build shares the runner, the config and the output with every other lint.
- **Removing `style` from the Bracket too** (native scrolling for pan, stepped zoom as classes). Changes the interaction to satisfy a lint rule. Rejected.

## Consequences

- `@shadcn/lint` supports React, Vue and Svelte, not Solid; it reads Solid's `class` because Solid spells it as Vue does. `scripts/shadcn-lint.test.ts` pins the forms this repo writes (string, object inside an array, `&&` inside an array, template literal, constant, `style` object) so a release that stops reading one fails a test instead of leaving `vp check` green. The version is not pinned exactly; that test is the guard.
- Two forms are not read: a bare object `class={{ ... }}` and a string `style="..."`. Conditional classes are therefore written as an object inside an array (`class={["base", { "text-win": won() }]}`), which is also what the Solid hard rules ask for; the string `style` falls under the `lint:theme` ban.
- Oxlint's JS plugin support is alpha. Accepted: the plugin sits behind one config key and one dev dependency.
- CSS files are not linted by either tool. ADR 0007 already keeps styling out of stylesheets; `src/theme.css` is the one that exists.
