import { ConnectionId, Identity, Timestamp } from "spacetimedb";
import {
  createModuleTestHarness,
  TestAuth,
  TestClock,
  type ModuleTestHarness,
} from "spacetimedb/server/test-utils";
import type { InferSchema, ReducerCtx } from "spacetimedb/server";
import schema, * as moduleExports from "../src/index";

/**
 * The seam the module tests are written against: the official
 * SpacetimeDB module test harness (SpacetimeDB 2.15's
 * `spacetimedb/server/test-utils`). The real `spacetimedb/server`
 * entry cannot be imported outside a module host (it loads the
 * host-only `spacetime:sys` module), so the `spacetimedb` Vitest
 * project in vitest.config.ts registers the harness's Vitest plugin,
 * which makes the module importable and backs it with a portable
 * in-process datastore.
 *
 * Everything a test touches is therefore the real thing: the
 * committed schema, real table handles (index find / filter / insert
 * semantics included), and view/reducer contexts whose sender is the
 * identity the harness derives from the test auth's JWT payload
 * (issuer + subject). Production identities are server-minted on a
 * tokenless connect instead — no JWT exists there — but the code
 * under test only ever sees `ctx.sender`, which is what the
 * derivation fixes. Wire-level facts (a private table rejecting a
 * subscription, a view delivering live updates) are beyond any
 * in-process harness; they are covered by spacetimedb/spike/.
 */

export type Harness = ModuleTestHarness<InferSchema<typeof schema>>;
export type Ctx = ReducerCtx<InferSchema<typeof schema>>;

const ISSUER = "https://auth.cobracket.test";

/** A harness on a fresh datastore, its clock pinned at `millis`. */
export function makeHarness(millis = 100_000): Harness {
  return createModuleTestHarness(schema, moduleExports, {
    clock: new TestClock(at(millis)),
  });
}

/**
 * An authenticated test auth for the subject `sub`. The harness
 * derives the sender Identity from iss+sub, so one sub is one stable
 * identity across harnesses.
 */
export function authFor(sub: string): TestAuth {
  return TestAuth.fromJwtPayload(
    JSON.stringify({ iss: ISSUER, sub, exp: 9_999_999_999 }),
    ConnectionId.random(),
  );
}

/** The sender identity `sub` maps to in this harness. */
export function identityFor(harness: Harness, sub: string): Identity {
  return harness.withReducerTx(authFor(sub), (ctx) => ctx.sender);
}

/** Runs `body` as `sub` in one reducer transaction and returns its result. */
export function as<T>(harness: Harness, sub: string, body: (ctx: Ctx) => T): T {
  return harness.withReducerTx(authFor(sub), body);
}

/** Runs `body` as the module itself (seeding and cross-user reads). */
export function asModule<T>(harness: Harness, body: (ctx: Ctx) => T): T {
  return harness.withReducerTx(TestAuth.internal(), body);
}

/** A Timestamp `millis` after the epoch. */
function at(millis: number): Timestamp {
  return new Timestamp(BigInt(millis) * 1000n);
}
