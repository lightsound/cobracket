import { Errored, Loading, Show, createSignal } from "solid-js";
import { errorFallback, errorMessage } from "./ErrorFallback";
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
  // Sign-in is a handler-initiated mutation, so its failure never reaches the
  // <Errored> boundary; surface it here and let another click retry.
  const [signInError, setSignInError] = createSignal<string | null>(null);

  async function startAsOrganizer() {
    setSignInError(null);
    try {
      await ensureOrganizer();
    } catch (error) {
      setSignInError(errorMessage(error));
    }
  }

  return (
    <Errored fallback={errorFallback}>
      <Loading fallback={<p class="status">Checking Organizer session…</p>}>
        <Show
          when={organizer()}
          fallback={
            <button class="increment" type="button" onClick={() => void startAsOrganizer()}>
              Start as Organizer
            </button>
          }
        >
          {(id) => <p class="status">Organizer {id()}</p>}
        </Show>
        <Show when={signInError()}>
          {(message) => (
            <p class="status error-fallback" role="alert">
              Sign-in failed: {message()}
            </p>
          )}
        </Show>
      </Loading>
    </Errored>
  );
}
