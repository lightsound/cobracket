// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// The auth seam is deliberately thin: the core/anonymous components are
// library code, so these tests cover only what the app owns — the createUser
// callback and the identity query every Organizer capability will build on.
// Operations-API tests (Seam 2) fake Organizers via withIdentity the same way.

const modules = import.meta.glob("./**/*.ts");

test("createUserAnonymous mints one bare user row per sign-up", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.mutation(internal.auth.createUserAnonymous, {
    provider: "anonymous",
    providerAccountId: "",
    profile: {},
  });
  const user = await t.run((ctx) => ctx.db.get("users", userId));
  expect(user).not.toBeNull();
});

test("currentOrganizer resolves the verified subject to a users id", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.mutation(internal.auth.createUserAnonymous, {
    provider: "anonymous",
    providerAccountId: "",
    profile: {},
  });
  const asOrganizer = t.withIdentity({ subject: userId });
  expect(await asOrganizer.query(api.auth.currentOrganizer, {})).toBe(userId);
});

test("currentOrganizer is null when signed out or the subject is not a user", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.auth.currentOrganizer, {})).toBeNull();
  const stranger = t.withIdentity({ subject: "not-a-users-id" });
  expect(await stranger.query(api.auth.currentOrganizer, {})).toBeNull();
});
