# Recorded results are the source of truth; everything downstream is derived

Amended by [ADR 0016](./0016-publication-freezes-structure.md): on a Track's tournament, progression is also derived from which Participants are withdrawn (below).

A tournament's recorded match results are the single source of truth. Bracket progression, standings, and rankings are derived values, recomputable from the results at any time; no design may store only an aggregate and discard the results that produced it. Corrections are a first-class operation from the MVP on — fixing a mis-entered result recomputes everything downstream — and every result record carries who reported it and when, so organizer overrides and participant self-reporting stay auditable.

**Amended 2026-10-11 (ADR 0016):** a withdrawn Participant's unplayed matches are walkovers, derived rather than recorded, so progression is computed from the recorded results **and the Participants' withdrawal state** — read from their Entries when progression is derived, never stored as an aggregate. A withdrawal therefore advances the opponent without the Organizer and without making the tournament live, and a substitution or restoration takes the derived walkover away again. That reversibility is allowed only while nothing rests on it: when a result is recorded that depends on a derived walkover, the system records that walkover first, in the same transaction, and from then on it is an ordinary result — attributed to the system, changed only by correction like any other. So every recorded result still rests only on recorded results, and the rest of this decision stands. Standalone tournaments have no Entries and therefore no withdrawals; their walkovers stay recorded by hand.

## Considered Options

Mutable in-place bracket state: simpler to write, but a wrong entry discovered rounds later cannot be safely unwound, and rankings drift from the results that produced them. Rejected.

Recording a walkover the moment a Participant withdraws (amendment): every withdrawal before play would make the tournament live and end the chance to unpublish, and a substitution or restoration would have to delete a result, which only corrections may change. Rejected.
