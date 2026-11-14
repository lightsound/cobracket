import { describe, expect, test } from "vite-plus/test";
import * as moduleExports from "../src/index";
import { as, asModule, authFor, makeHarness, type Harness } from "./harness";

// The identity seam's tests (migration slice M2): the port of
// convex/auth.test.ts to the module harness. The Convex file covered
// what the app owned around the auth library — the createUser
// callback and the identity queries. The module owns the whole seam,
// and the mapping is: anonymous sign-up (createUserAnonymous) becomes
// bindIdentity, the first-act binding of ADR 0031; a verified JWT
// subject becomes a harness identity derived from a test JWT (see
// harness.ts); the session queries become sender-gated views.
//
// One Convex case has no counterpart and is replaced, not dropped:
// "the subject is not a user" (a user id forged as a subject, or a
// well-formed id from another table) cannot occur here — an Identity
// is server-minted and unforgeable, and the binding table is the only
// path from an identity to a user. The property it protected — a
// foreign identifier must not resolve to someone else's user — is
// asserted below in the form this platform gives it: one identity's
// binding never answers for another identity.

const ALICE = "alice";
const BOB = "bob";

/** Binds `sub`'s identity (the sign-up) and returns its app_user id. */
function signUp(harness: Harness, sub: string): bigint {
  as(harness, sub, (ctx) => {
    moduleExports.bindIdentity(ctx, {});
  });
  const row = moduleExports.currentOrganizer(harness.viewContext(authFor(sub)));
  expect(row).toBeDefined();
  return row!.userId;
}

function appUserCount(harness: Harness): number {
  return asModule(harness, (ctx) => [...ctx.db.appUser.iter()].length);
}

describe("identity binding and session views", () => {
  test("bindIdentity mints one bare user row per identity, idempotently", () => {
    const harness = makeHarness();
    const userId = signUp(harness, ALICE);
    const user = asModule(harness, (ctx) => ctx.db.appUser.id.find(userId));
    expect(user).not.toBeNull();
    // Binding again is the same binding, not a second user.
    expect(signUp(harness, ALICE)).toBe(userId);
    expect(appUserCount(harness)).toBe(1);
    const otherId = signUp(harness, BOB);
    expect(otherId).not.toBe(userId);
    expect(appUserCount(harness)).toBe(2);
  });

  test("currentOrganizer resolves the bound identity to its user id", () => {
    const harness = makeHarness();
    const userId = signUp(harness, ALICE);
    expect(moduleExports.currentOrganizer(harness.viewContext(authFor(ALICE)))).toEqual({
      userId,
    });
  });

  test("sessionState distinguishes missing users from unauthenticated callers", () => {
    const harness = makeHarness();
    // Never bound: unauthenticated, and currentOrganizer answers nothing.
    expect(moduleExports.sessionState(harness.viewContext(authFor(ALICE)))).toEqual([
      { state: { tag: "unauthenticated" } },
    ]);
    expect(moduleExports.currentOrganizer(harness.viewContext(authFor(ALICE)))).toBeUndefined();
    const userId = signUp(harness, ALICE);
    expect(moduleExports.sessionState(harness.viewContext(authFor(ALICE)))).toEqual([
      { state: { tag: "organizer", value: { userId } } },
    ]);
    // The distinction the client's recovery depends on: an identity
    // whose user row is gone must NOT read as merely unauthenticated.
    asModule(harness, (ctx) => {
      ctx.db.appUser.id.delete(userId);
    });
    expect(moduleExports.sessionState(harness.viewContext(authFor(ALICE)))).toEqual([
      { state: { tag: "user_missing" } },
    ]);
  });

  test("currentOrganizer is empty for a deleted user's still-live identity", () => {
    const harness = makeHarness();
    const userId = signUp(harness, ALICE);
    asModule(harness, (ctx) => {
      ctx.db.appUser.id.delete(userId);
    });
    expect(moduleExports.currentOrganizer(harness.viewContext(authFor(ALICE)))).toBeUndefined();
  });

  test("one identity's binding never answers for another", () => {
    const harness = makeHarness();
    const aliceId = signUp(harness, ALICE);
    // Bob, unbound, resolves to nothing — not to Alice's user.
    expect(moduleExports.currentOrganizer(harness.viewContext(authFor(BOB)))).toBeUndefined();
    expect(moduleExports.sessionState(harness.viewContext(authFor(BOB)))).toEqual([
      { state: { tag: "unauthenticated" } },
    ]);
    // And once Bob binds, he is his own user, not Alice's.
    const bobId = signUp(harness, BOB);
    expect(bobId).not.toBe(aliceId);
    expect(moduleExports.currentOrganizer(harness.viewContext(authFor(BOB)))).toEqual({
      userId: bobId,
    });
  });

  test("a dangling binding refuses reducer calls instead of minting a replacement user", () => {
    const harness = makeHarness();
    const userId = signUp(harness, ALICE);
    asModule(harness, (ctx) => {
      ctx.db.appUser.id.delete(userId);
    });
    // requireBoundUser's refusal — the mirror of requireOrganizer's
    // "Not signed in" when getOrganizer resolves null — and no
    // resurrection: the identity stays user_missing, with no new
    // app_user minted under the same credential.
    expect(() =>
      as(harness, ALICE, (ctx) => {
        moduleExports.bindIdentity(ctx, {});
      }),
    ).toThrow(/Not signed in/);
    expect(appUserCount(harness)).toBe(0);
    expect(moduleExports.sessionState(harness.viewContext(authFor(ALICE)))).toEqual([
      { state: { tag: "user_missing" } },
    ]);
  });

  test("a harness transaction that throws after binding rolls the binding back", () => {
    const harness = makeHarness();
    // requireBoundUser is every reducer's first act: bindIdentity is
    // its thinnest caller, and its success leaves the binding behind —
    // an anonymous binding naming the one app_user row.
    as(harness, ALICE, (ctx) => {
      moduleExports.bindIdentity(ctx, {});
    });
    const aliceId = asModule(harness, (ctx) => BigInt([...ctx.db.appUser.iter()][0]!.id));
    expect(moduleExports.currentOrganizer(harness.viewContext(authFor(ALICE)))).toEqual({
      userId: aliceId,
    });
    expect(moduleExports.sessionState(harness.viewContext(authFor(ALICE)))).toEqual([
      { state: { tag: "organizer", value: { userId: aliceId } } },
    ]);
    const binding = as(harness, ALICE, (ctx) => {
      const row = ctx.db.identityUser.identity.find(ctx.sender);
      return row === null ? null : { kindTag: row.kind.tag, userId: row.userId };
    });
    expect(binding).toEqual({ kindTag: "anonymous", userId: aliceId });
    // Atomicity at the harness seam: a transaction that throws after
    // binding rolls the binding back with everything else. The body
    // here is the test's own closure inside withReducerTx, not a
    // dispatched reducer — reducer-level bind-then-fail coverage
    // rides with the write reducers that can actually fail after
    // binding (M2's operations tests).
    expect(() =>
      as(harness, BOB, (ctx) => {
        moduleExports.bindIdentity(ctx, {});
        throw new Error("boom");
      }),
    ).toThrow(/boom/);
    expect(moduleExports.sessionState(harness.viewContext(authFor(BOB)))).toEqual([
      { state: { tag: "unauthenticated" } },
    ]);
    expect(appUserCount(harness)).toBe(1);
  });
});
