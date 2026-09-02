import { useNavigate } from "@solidjs/router";
import { Errored, For, Loading, Show, createSignal } from "solid-js";
import { api } from "../../convex/_generated/api";
import { DisciplineInput } from "../DisciplineInput";
import { ErrorNotice, errorFallback, errorMessage } from "../ErrorFallback";
import { FormatFieldset, type FormatFamily } from "../FormatFieldset";
import { SetupNotice } from "../SetupNotice";
import { StatusBadge } from "../StatusBadge";
import { t } from "../i18n";
import { createOrganizer, ensureOrganizer } from "../lib/auth";
import { createConvexQuery, getConvexClient, getConvexUrl } from "../lib/convex";
// fallow-ignore-next-line circular-dependency -- the official Solid Router 2 shape: the router lazy-imports pages (deferred dynamic import), pages link back through Router.paths; no init-order hazard
import { Router } from "../router";

export default function Home() {
  if (!getConvexUrl()) return <SetupNotice />;
  const organizer = createOrganizer();

  return (
    <div class="flex flex-col gap-10">
      <section class="flex flex-col gap-3">
        <h2 class="font-display text-xl font-medium">{t("home.heading")}</h2>
        <Errored fallback={errorFallback}>
          <Loading fallback={<p class="text-sm text-ink-muted">{t("home.checkingSession")}</p>}>
            <Show
              when={organizer()}
              fallback={<p class="text-sm text-ink-muted">{t("home.signedOut")}</p>}
            >
              <TournamentList />
            </Show>
          </Loading>
        </Errored>
      </section>
      <CreateForm />
    </div>
  );
}

function TournamentList() {
  const tournaments = createConvexQuery(api.operations.listMyTournaments, {});

  return (
    <Loading fallback={<p class="text-sm text-ink-muted">{t("app.loading")}</p>}>
      <ul class="flex flex-col gap-2">
        <For
          each={tournaments()}
          keyed={(row) => row.tournamentId}
          fallback={<li class="text-sm text-ink-muted">{t("home.empty")}</li>}
        >
          {(row) => (
            <li>
              <a
                href={Router.paths.t(row().tournamentId)}
                class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-ink-muted/30 bg-surface-raised px-4 py-3 transition-colors hover:border-accent"
              >
                <span class="font-display font-medium">{row().name}</span>
                <span class="text-sm text-ink-muted">{row().discipline}</span>
                <span class="text-sm text-ink-muted">{t(`format.${row().format.family}`)}</span>
                <span class="ms-auto">
                  <StatusBadge status={row().status} />
                </span>
              </a>
            </li>
          )}
        </For>
      </ul>
    </Loading>
  );
}

function CreateForm() {
  const navigate = useNavigate();
  const [name, setName] = createSignal("");
  const [discipline, setDiscipline] = createSignal("");
  const [family, setFamily] = createSignal<FormatFamily>("single_elimination");
  const [createError, setCreateError] = createSignal<string | null>(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const convex = getConvexClient();
    if (!convex) return;
    setCreateError(null);
    try {
      await ensureOrganizer();
      const created = await convex.mutation(api.operations.createTournament, {
        name: name(),
        discipline: discipline(),
        format: { family: family() },
      });
      navigate(Router.paths.t(created.tournamentId));
    } catch (error) {
      setCreateError(errorMessage(error));
    }
  }

  return (
    <section class="flex max-w-xl flex-col gap-3">
      <h2 class="font-display text-xl font-medium">{t("home.create.heading")}</h2>
      <form class="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-ink-muted">{t("home.create.name")}</span>
          <input
            class="rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-2 text-base"
            required
            value={name()}
            placeholder={t("home.create.namePlaceholder")}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-ink-muted">{t("home.create.discipline")}</span>
          <DisciplineInput
            class="rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-2 text-base"
            value={discipline()}
            onInput={(value) => setDiscipline(value)}
          />
        </label>
        <FormatFieldset value={family()} onChange={(next) => setFamily(next)} />
        <Show when={createError()}>{(message) => <ErrorNotice message={message()} />}</Show>
        <button
          type="submit"
          class="self-start rounded-md bg-accent px-4 py-2 font-medium text-surface transition-opacity hover:opacity-90"
        >
          {t("home.create.submit")}
        </button>
      </form>
    </section>
  );
}
