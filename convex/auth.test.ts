/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// The auth seam is deliberately thin: the core/anonymous components are
// library code, so these tests cover only what the app owns — the createUser
// callback and the identity query every Organizer capability will build on.
// Operations-API tests (Seam 2) fake Organizers via withIdentity the same way.

// Test files are excluded: convex-test only needs the function modules, and
// globbing sibling tests would create test-to-test import cycles.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

type Test = ReturnType<typeof convexTest>;

// What the anonymous provider sends the createUser callback on every sign-up.
function signUp(t: Test) {
  return t.mutation(internal.auth.createUserAnonymous, {
    provider: "anonymous",
    providerAccountId: "",
    profile: {},
  });
}

test("createUserAnonymous mints one bare user row per sign-up", async () => {
  const t = convexTest(schema, modules);
  const userId = await signUp(t);
  const user = await t.run((ctx) => ctx.db.get("users", userId));
  expect(user).not.toBeNull();
});

test("currentOrganizer resolves the verified subject to a users id", async () => {
  const t = convexTest(schema, modules);
  const userId = await signUp(t);
  const asOrganizer = t.withIdentity({ subject: userId });
  expect(await asOrganizer.query(api.auth.currentOrganizer, {})).toBe(userId);
});

test("sessionState distinguishes missing users from unauthenticated callers", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.auth.sessionState, {})).toEqual({ kind: "unauthenticated" });
  const userId = await signUp(t);
  const asOrganizer = t.withIdentity({ subject: userId });
  expect(await asOrganizer.query(api.auth.sessionState, {})).toEqual({
    kind: "organizer",
    userId,
  });
  // The distinction the client's recovery depends on: a verified JWT whose
  // user row is gone must NOT read as merely unauthenticated.
  await t.run((ctx) => ctx.db.delete("users", userId));
  expect(await asOrganizer.query(api.auth.sessionState, {})).toEqual({ kind: "user_missing" });
});

test("currentOrganizer is null for a deleted user's still-live session", async () => {
  const t = convexTest(schema, modules);
  const userId = await signUp(t);
  await t.run((ctx) => ctx.db.delete("users", userId));
  const ghost = t.withIdentity({ subject: userId });
  expect(await ghost.query(api.auth.currentOrganizer, {})).toBeNull();
});

test("currentOrganizer is null when signed out or the subject is not a user", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.auth.currentOrganizer, {})).toBeNull();
  const stranger = t.withIdentity({ subject: "not-a-users-id" });
  expect(await stranger.query(api.auth.currentOrganizer, {})).toBeNull();
  // A well-formed id from another table must not pass either — the
  // normalizeId guard in getOrganizer is what turns it into null.
  const foreignId = await t.run((ctx) =>
    ctx.db.insert("disciplines", { name: "Chess", normalizedName: "chess" }),
  );
  const foreign = t.withIdentity({ subject: foreignId });
  expect(await foreign.query(api.auth.currentOrganizer, {})).toBeNull();
});
