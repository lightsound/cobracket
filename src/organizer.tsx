import { createContext, useContext, type Accessor, type ParentProps } from "solid-js";
import type { Id } from "../convex/_generated/dataModel";
import { createOrganizer } from "./lib/auth";

/**
 * The current Organizer, as one subscription for the whole mounted app.
 *
 * Every page used to call `createOrganizer()` for itself, which meant one
 * `currentOrganizer` subscription per page visit: the previous page's was
 * disposed on unmount, the next page's opened on mount, and the Convex client
 * answered the new one with a round trip — so every page began with a
 * "Checking your session…" fallback that cost one RTT before the page's own
 * data could even be asked for. Measured in Chromium against a local
 * deployment with 100ms of one-way latency: 200ms on the Home boundary, then
 * another 200ms on the tournament list behind it, the engine naming the
 * pair an `[ASYNC_WATERFALL]`. The one exception was the management page
 * reached from Home, where the router created the new page before disposing
 * the old one, so the client still held the subscription and answered from
 * it in 2ms — which is the behaviour every page should have.
 *
 * Session identity is app-wide state, and app-wide state lives in a provider
 * at the root of `App` (CLAUDE.md rule 11). Creating the query here keeps the
 * subscription alive for the app's lifetime, so a page reads an answer the
 * client already holds. The memo is lazy: nothing subscribes until a page
 * reads it under its boundaries, so providers mounted without a configured
 * client (tests of components that never touch the backend) open nothing.
 */
const OrganizerContext = createContext<Accessor<Id<"users"> | null>>();

/**
 * @public
 */
export function OrganizerProvider(props: ParentProps) {
  return <OrganizerContext value={createOrganizer()}>{props.children}</OrganizerContext>;
}

/**
 * The current Organizer's user id, or null when signed out. An async read:
 * take it under `<Loading>` / `<Errored>` boundaries, gated on
 * `getConvexUrl()` like every other Convex read.
 *
 * @public
 */
export function useOrganizer(): Accessor<Id<"users"> | null> {
  return useContext(OrganizerContext);
}
