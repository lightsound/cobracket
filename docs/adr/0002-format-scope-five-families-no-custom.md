# Formats stop at five families; no custom formats

cobracket supports five format families: single elimination, double elimination, round robin, Swiss, and group stage into playoffs. Freeform or user-defined custom formats are explicitly out of scope: demand is unclear and they explode the complexity of bracket generation, progression, and UI.

Amended on 2026-11-21 (comment audit): draws. A tournament's `drawsAllowed` flag exists in the schema, but no path carries it into the format engine's family rules yet, and elimination families reject draws unconditionally. Both gaps close together: when the first draw-capable family lands, `drawsAllowed` is threaded through `FormatOptions` into the family rules, and that same family owns draw advancement through `winnerOf`/`loserOf` slots. Until then the evaluator fails with a typed error rather than dereferencing a winner a drawn match does not have.

## Consequences

The MVP ships single and double elimination only, but the Format abstraction must keep the other three families implementable without redesign.
