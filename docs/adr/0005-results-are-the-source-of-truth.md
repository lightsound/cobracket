# Recorded results are the source of truth; everything downstream is derived

A tournament's recorded match results are the single source of truth. Bracket progression, standings, seeding, and rankings are derived values, recomputable from the results at any time; no design may store only an aggregate and discard the results that produced it. Corrections are a first-class operation from the MVP on — fixing a mis-entered result recomputes everything downstream — and every result record carries who reported it and when, so organizer overrides and participant self-reporting stay auditable.

## Considered Options

Mutable in-place bracket state: simpler to write, but a wrong entry discovered rounds later cannot be safely unwound, and rankings drift from the results that produced them. Rejected.
