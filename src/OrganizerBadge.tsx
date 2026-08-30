import { Errored, Loading, Show } from "solid-js";
import { errorFallback } from "./ErrorFallback";
import { createOrganizer, ensureOrganizer } from "./lib/auth";
import { getConvexUrl } from "./lib/convex";

/**
 * Minimal surface over the auth module (ADR 0003) in the scaffold UI: shows
 * the verified Organizer identity and offers the zero-sign-up entry (story 1).
 * The MVP screens will replace this along with the tasks demo.
 */
export default function OrganizerBadge() {
  if (!getConvexUrl()) return null;
  const organizer = createOrganizer();

  return (
    <Errored fallback={errorFallback}>
      <Loading fallback={<p class="status">Checking Organizer session…</p>}>
        <Show
          when={organizer()}
          fallback={
            <button class="increment" type="button" onClick={() => void ensureOrganizer()}>
              Start as Organizer
            </button>
          }
        >
          {(id) => <p class="status">Organizer {id()}</p>}
        </Show>
      </Loading>
    </Errored>
  );
}
