import type { Accessor } from "solid-js";
import { createBackendQuery } from "../backend";
import { api as seamApi } from "../operations";

// The auth boundary and its implementation: docs/adr/0031-adopt-spacetimedb-as-the-backend.md.

/**
 * Bootstrap the auth session for this browser — contract: docs/adr/0031-adopt-spacetimedb-as-the-backend.md.
 *
 * @public
 */
export function initAuth(): void {
  void import("./spacetimedb").then((impl) => impl.initSpacetimeAuth());
}

/**
 * Make sure the caller has an Organizer identity — contract: docs/adr/0031-adopt-spacetimedb-as-the-backend.md.
 *
 * @public
 */
export async function ensureOrganizer(): Promise<void> {
  const impl = await import("./spacetimedb");
  await impl.ensureSpacetimeOrganizer();
}

/** @public */
export function createOrganizer(): Accessor<string | null> {
  return createBackendQuery(seamApi.auth.currentOrganizer, {});
}
