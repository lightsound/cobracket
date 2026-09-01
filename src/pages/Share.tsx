import { useParams } from "@solidjs/router";
import { Errored, Loading, Show } from "solid-js";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { errorFallback } from "../ErrorFallback";
import { SetupNotice } from "../SetupNotice";
import { TournamentBoard } from "../TournamentBoard";
import { TournamentHeader } from "../TournamentHeader";
import { t } from "../i18n";
import { createConvexQuery, getConvexUrl } from "../lib/convex";
// fallow-ignore-next-line circular-dependency -- the official Solid Router 2 shape: the router lazy-imports pages (deferred dynamic import), pages link back through Router.paths; no init-order hazard
import { Router } from "../router";

type SharedView = NonNullable<FunctionReturnType<typeof api.operations.getSharedTournament>>;

export default function SharePage() {
  if (!getConvexUrl()) return <SetupNotice />;
  const params = useParams(Router.paths.s);
  const shared = createConvexQuery(api.operations.getSharedTournament, () => ({
    shareSlug: params.shareSlug,
  }));

  return (
    <Errored fallback={errorFallback}>
      <Loading fallback={<p class="text-sm text-ink-muted">{t("app.loading")}</p>}>
        <Show
          when={shared()}
          fallback={<p class="text-sm text-ink-muted">{t("share.notFound")}</p>}
        >
          {(view) => <SharedTournament view={view()} />}
        </Show>
      </Loading>
    </Errored>
  );
}

function SharedTournament(props: { view: SharedView }) {
  return (
    <div class="flex flex-col gap-6">
      <TournamentHeader
        name={props.view.name}
        status={props.view.status}
        discipline={props.view.discipline}
        formatFamily={props.view.format.family}
      />
      <TournamentBoard
        bracket={props.view.bracket}
        participants={props.view.participants}
        completed={props.view.status === "completed"}
        fallback={<p class="text-sm text-ink-muted">{t("share.bracketPending")}</p>}
      />
    </div>
  );
}
