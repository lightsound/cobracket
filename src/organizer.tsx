import { createContext, useContext, type Accessor, type ParentProps } from "solid-js";
import { createOrganizer } from "./lib/auth";

const OrganizerContext = createContext<Accessor<string | null>>();

/**
 * @public
 */
export function OrganizerProvider(props: ParentProps) {
  return <OrganizerContext value={createOrganizer()}>{props.children}</OrganizerContext>;
}

/**
 * The current Organizer's user id, or null when signed out. An async read:
 * take it under `<Loading>` / `<Errored>` boundaries, gated on
 * `getBackendUrl()` like every other backend read.
 *
 * @public
 */
export function useOrganizer(): Accessor<string | null> {
  return useContext(OrganizerContext);
}
