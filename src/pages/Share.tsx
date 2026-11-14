import { useParams } from "@solidjs/router";
import { Errored, Loading, Show } from "solid-js";
import { api } from "../lib/operations";
import type { TournamentView } from "../lib/operations";
import { errorFallback } from "../ErrorFallback";
import { SetupNotice } from "../SetupNotice";
import { TournamentBoard } from "../TournamentBoard";
import { TournamentHeader } from "../TournamentHeader";
import { useI18n } from "../i18n";
import { createBackendQuery, getBackendUrl } from "../lib/backend";
// fallow-ignore-next-line circular-dependency -- the official Solid Router 2 shape: the router lazy-imports pages (deferred dynamic import), pages link back through Router.paths; no init-order hazard
import { Router } from "../router";

type SharedView = TournamentView;

export default function SharePage() {
  const { t } = useI18n();
  if (!getBackendUrl()) return <SetupNotice />;
  const params = useParams(Router.paths.s);
  const shared = createBackendQuery(api.share.getSharedTournament, () => ({
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
  const { t } = useI18n();
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
