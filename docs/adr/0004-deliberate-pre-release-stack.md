# Deliberately build on a pre-release stack

cobracket is built on Solid 2.0 (release candidate), Convex, and Convex Auth v2 (preview) — chosen before any of them reached stable. This is deliberate: the project has no imminent production deadline, so we trade today's stability for the newest platform primitives (fine-grained reactivity, realtime-first backend) and for the chance to be an early showcase for those ecosystems. ADR 0003 records the auth-specific slice of this bet.

## Consequences

- Breaking changes in dependencies are expected and treated as routine work, not incidents.
- Each risky dependency stays behind a narrow module boundary (enforced with ImportLint) so any single bet can be unwound without rewriting the app.
