# Style with Tailwind CSS v4; render the Bracket from a pure layout module

Development is AI-agent-driven, which reorders the usual styling trade-offs. We adopt Tailwind CSS v4 (via `@tailwindcss/vite`) for all app styling because it keeps every styling edit local to the TSX being changed, and because none of this repo's quality gates (fallow, ImportLint, solid2-kit check) watches CSS files — hand-written stylesheets would be the one place where agent-produced dead code accumulates unseen, while Tailwind compiles unused styles away. Design tokens are a small semantic set in `@theme` (surface, ink, accent, plus Match-state tokens such as live, win, loss), themed dark and light through `light-dark()` with `color-scheme`, following the OS by default with a manual toggle. One variable webfont provides visual identity; score digits always render with `tabular-nums`.

The Bracket — the core surface of the product — is not styled into shape; it is computed. Bracket geometry is closed-form (slot and round determine position), so a pure module, `layoutBracket(structure) → cards + edges`, produces serializable coordinates with no DOM measurement, unit-tested like the format engine. The interactive view absolutely positions HTML Match cards from those coordinates and draws all connectors in a single SVG overlay behind them. HTML cards keep text truncation, focus, popovers, and i18n for free; SVG paths make double-elimination loser-drop connectors and win-path highlighting one path each. The same layout data can later feed a static SVG renderer (Share Link OGP images, Discord unfurls, print) and a compact text renderer for MCP responses (ADR 0001).

## Considered Options

- Plain CSS only: viable while small, but agent-maintained stylesheets drift (two-file edits, duplicated near-identical rules) with no gate to catch it. Rejected.
- CSS Grid + pseudo-element connectors (the Leaguepedia pattern): proven and measurement-free, but the connector logic lives in CSS border craft that cannot be unit-tested, and double-elimination loser-drop lines do not fit the grid's regularity. Rejected.
- SVG with `foreignObject`-embedded cards (most React bracket libraries): WebKit ignores `x`/`y`/`transform` on `foreignObject`, collapsing every card to the origin on iOS Safari — the Spectator's browser. Rejected.
- Full-SVG cards (Challonge's engine): a single coordinate system and free image export, but text truncation, focus, and Organizer result-entry UI must all be rebuilt. Rejected for the interactive view; the future static-export renderer may use it.
- CSS Anchor Positioning for connectors: Baseline Newly Available only since January 2026 (~84% coverage), and the OddBird polyfill does not support dynamically inserted elements — which a realtime Convex-driven Bracket consists of entirely. Deferred to progressive enhancement (hover highlights, popovers) behind `@supports`; the `::tether` connector proposal is unimplemented Level 2 discussion.
- Canvas/WebGL, graph-layout engines (dagre, ELK), existing bracket libraries: 8–64 participants need no culling, closed-form geometry needs no solver, and no library supports Solid 2. Rejected.

## Consequences

- Renderers are swappable consumers of layout data; migrating connectors (e.g. to Anchor Positioning once coverage saturates) touches one renderer, not the data model.
- Card dimensions are fixed: Participant names truncate, and small screens pan/zoom via transform instead of reflowing.
- The layout module joins the format engine as a Seam 1 pure module: coordinates are asserted in unit tests without a browser.
