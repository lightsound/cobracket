# Deliberately build on a pre-release stack

Amended by [ADR 0031](./0031-adopt-spacetimedb-as-the-backend.md) (2026-11-15): the backend bet moved from Convex and Convex Auth v2 to SpacetimeDB 2.15; the bet itself — the newest platform primitives over today's stability — is unchanged in kind.

cobracket is built on Solid 2.0 (release candidate) and SpacetimeDB 2.15 — with 0.1.0 submodules where they are used — chosen before either line settled. This is deliberate: the project has no imminent production deadline, so we trade today's stability for the newest platform primitives (fine-grained reactivity, a realtime-first backend whose execution is serial) and for the chance to be an early showcase for those ecosystems. ADR 0031 records the backend slice of this bet, which began as ADR 0003's auth bet.

## Consequences

- Breaking changes in dependencies are expected and treated as routine work, not incidents.
- Each risky dependency stays behind a narrow module boundary (enforced with ImportLint) so any single bet can be unwound without rewriting the app.
