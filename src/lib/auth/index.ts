import type { Accessor } from "solid-js";
import { backendSelection, createBackendQuery } from "../backend";
import { api as seamApi } from "../operations";
import { ensureConvexOrganizer, initConvexAuth } from "./convex";

// The auth boundary and its two implementations: docs/adr/0031-adopt-spacetimedb-as-the-backend.md.

/**
 * Bootstrap the auth session for this browser — contract: docs/adr/0031-adopt-spacetimedb-as-the-backend.md.
 *
 * @public
 */
export function initAuth(): void {
  if (backendSelection() === "spacetimedb") {
    void import("./spacetimedb").then((impl) => impl.initSpacetimeAuth());
  } else {
    initConvexAuth();
  }
}

/**
 * Make sure the caller has an Organizer identity — contract: docs/adr/0031-adopt-spacetimedb-as-the-backend.md.
 *
 * @public
 */
export async function ensureOrganizer(): Promise<void> {
  if (backendSelection() === "spacetimedb") {
    const impl = await import("./spacetimedb");
    await impl.ensureSpacetimeOrganizer();
  } else {
    await ensureConvexOrganizer();
  }
}

/** @public */
export function createOrganizer(): Accessor<string | null> {
  return createBackendQuery(seamApi.auth.currentOrganizer, {});
}
