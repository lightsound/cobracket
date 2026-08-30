# Formats stop at five families; no custom formats

cobracket supports five format families: single elimination, double elimination, round robin, Swiss, and group stage into playoffs. Freeform or user-defined custom formats are explicitly out of scope: demand is unclear and they explode the complexity of bracket generation, progression, and UI.

## Consequences

The MVP ships single and double elimination only, but the Format abstraction must keep the other three families implementable without redesign.
