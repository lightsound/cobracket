import { useNavigate, useParams } from "@solidjs/router";
import { Portal } from "@solidjs/web";
import { Errored, For, Loading, Show, createSignal } from "solid-js";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DisciplineInput } from "../DisciplineInput";
import { ErrorNotice, errorFallback, errorMessage } from "../ErrorFallback";
import { FormatFieldset, type FormatFamily } from "../FormatFieldset";
import { SetupNotice } from "../SetupNotice";
import { createOrganizer } from "../lib/auth";
import { TournamentBoard } from "../TournamentBoard";
import { TournamentHeader } from "../TournamentHeader";
import { t } from "../i18n";
import { createConvexQuery, getConvexUrl, runMutation } from "../lib/convex";
// fallow-ignore-next-line circular-dependency -- the official Solid Router 2 shape: the router lazy-imports pages (deferred dynamic import), pages link back through Router.paths; no init-order hazard
import { Router } from "../router";

type OrganizerView = NonNullable<FunctionReturnType<typeof api.operations.getTournament>>;
type OrganizerMatch = NonNullable<OrganizerView["bracket"]>["matches"][number];

export default function TournamentPage() {
  if (!getConvexUrl()) return <SetupNotice />;
  const params = useParams(Router.paths.t);
  // getTournament rejects unauthenticated callers, so the subscription must
  // wait for the restored session — otherwise a direct open or reload of
  // this URL lands on the error fallback even for the owner.
  const organizer = createOrganizer();

  return (
    <Errored fallback={errorFallback}>
      <Loading fallback={<p class="text-sm text-ink-muted">{t("home.checkingSession")}</p>}>
        <Show when={organizer()} fallback={<BackHomeNotice message={t("tournament.signedOut")} />}>
          <OwnedTournament tournamentId={params.tournamentId} />
        </Show>
      </Loading>
    </Errored>
  );
}

// A terminal state of this URL for this browser (no session, or the id
// names nothing of ours): explain and offer the way out, no Retry.
function BackHomeNotice(props: { message: string }) {
  return (
    <div class="flex flex-col items-start gap-3">
      <p class="text-sm text-ink-muted">{props.message}</p>
      <a href={Router.paths()} class="text-sm text-accent underline">
        {t("app.backHome")}
      </a>
    </div>
  );
}

function OwnedTournament(props: { tournamentId: string }) {
  // The raw URL segment goes to the server as-is: getTournament answers null
  // for malformed, missing, deleted, and foreign ids alike.
  const view = createConvexQuery(api.operations.getTournament, () => ({
    tournamentId: props.tournamentId,
  }));

  return (
    <Loading fallback={<p class="text-sm text-ink-muted">{t("app.loading")}</p>}>
      <Show when={view()} fallback={<BackHomeNotice message={t("tournament.notFound")} />}>
        {(owned) => <Manager view={owned()} />}
      </Show>
    </Loading>
  );
}

function bracketPlaceholder(view: OrganizerView): string {
  if (view.participants.length < 2) return t("bracket.needTwo");
  return view.status === "published" ? t("bracket.stale") : t("bracket.none");
}

function Manager(props: { view: OrganizerView }) {
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [voidedCount, setVoidedCount] = createSignal(0);
  const [reportKey, setReportKey] = createSignal<string | null>(null);

  const editable = () => props.view.status === "draft" || props.view.status === "published";
  const reportingOpen = () => props.view.status !== "draft";
  const reportMatch = () => {
    const key = reportKey();
    if (key === null) return undefined;
    return props.view.bracket?.matches.find((match) => match.key === key);
  };

  return (
    <div class="flex flex-col gap-8">
      <TournamentHeader
        name={props.view.name}
        status={props.view.status}
        discipline={props.view.discipline}
        formatFamily={props.view.format.family}
      >
        <ShareLinkRow shareSlug={props.view.shareSlug} />
      </TournamentHeader>

      <Show when={actionError()}>{(message) => <ErrorNotice message={message()} />}</Show>

      <RosterSection
        view={props.view}
        editable={editable()}
        onError={(message) => setActionError(message)}
      />

      <section class="flex flex-col gap-3">
        <BracketControls
          view={props.view}
          editable={editable()}
          onError={(message) => setActionError(message)}
        />
        <Show when={voidedCount() > 0}>
          <ErrorNotice message={t("report.voided", { count: voidedCount() })}>
            <button
              type="button"
              class="rounded-md border border-ink-muted/40 bg-surface px-2 py-1 text-sm text-ink"
              onClick={() => setVoidedCount(0)}
            >
              {t("report.cancel")}
            </button>
          </ErrorNotice>
        </Show>
        <TournamentBoard
          bracket={props.view.bracket}
          participants={props.view.participants}
          completed={props.view.status === "completed"}
          fallback={<p class="text-sm text-ink-muted">{bracketPlaceholder(props.view)}</p>}
          onSelectMatch={reportingOpen() ? (key) => setReportKey(key) : undefined}
        />
      </section>

      <SettingsSection view={props.view} formatEditable={editable()} />

      <Portal>
        <Show when={reportMatch()}>
          {(match) => (
            <ReportDialog
              match={match()}
              reportKey={reportKey() ?? ""}
              participants={props.view.participants}
              onClose={() => setReportKey(null)}
              onReported={(voided) => {
                setVoidedCount(voided);
                setReportKey(null);
              }}
            />
          )}
        </Show>
      </Portal>
    </div>
  );
}

function BracketControls(props: {
  view: OrganizerView;
  editable: boolean;
  onError: (message: string | null) => void;
}) {
  const canPublish = () => props.view.status === "draft" && props.view.bracket !== null;

  async function run(mutate: () => Promise<unknown>): Promise<void> {
    props.onError(null);
    try {
      await mutate();
    } catch (error) {
      props.onError(errorMessage(error));
    }
  }

  return (
    <>
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="font-display text-xl font-medium">{t("bracket.heading")}</h2>
        <Show when={props.editable}>
          <button
            type="button"
            class="rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
            disabled={props.view.participants.length < 2}
            onClick={() =>
              void run(() =>
                runMutation(api.operations.generateBracket, {
                  tournamentId: props.view.tournamentId,
                }),
              )
            }
          >
            {props.view.bracket === null ? t("bracket.generate") : t("bracket.regenerate")}
          </button>
        </Show>
        <Show when={canPublish()}>
          <button
            type="button"
            class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90"
            title={t("bracket.publishHint")}
            onClick={() =>
              void run(() =>
                runMutation(api.operations.publishTournament, {
                  tournamentId: props.view.tournamentId,
                }),
              )
            }
          >
            {t("bracket.publish")}
          </button>
        </Show>
      </div>
      <Show when={canPublish()}>
        <p class="text-sm text-ink-muted">{t("bracket.publishHint")}</p>
      </Show>
    </>
  );
}

function ShareLinkRow(props: { shareSlug: string }) {
  const [copyState, setCopyState] = createSignal<"idle" | "copied" | "failed">("idle");
  const shareUrl = () => `${window.location.origin}${Router.paths.s(props.shareSlug)()}`;

  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(state: "copied" | "failed") {
    setCopyState(state);
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => setCopyState("idle"), 2500);
  }

  // The clipboard API rejects on insecure contexts (e.g. plain-HTTP LAN
  // access during a venue tournament) and denied permission; the visible
  // URL is the manual fallback.
  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl());
      flash("copied");
    } catch {
      flash("failed");
    }
  }

  return (
    <div class="flex flex-col gap-1">
      <div class="flex flex-wrap items-center gap-2">
        <a href={Router.paths.s(props.shareSlug)} class="text-sm text-accent underline">
          {shareUrl()}
        </a>
        <button
          type="button"
          class="rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-1 text-sm hover:border-accent"
          onClick={() => void copy()}
        >
          {copyState() === "copied" ? t("tournament.share.copied") : t("tournament.share.copy")}
        </button>
        <Show when={copyState() === "failed"}>
          <span class="text-xs text-loss">{t("tournament.share.copyFailed")}</span>
        </Show>
      </div>
      <p class="text-xs text-ink-muted">{t("tournament.share.hint")}</p>
    </div>
  );
}

function RosterSection(props: {
  view: OrganizerView;
  editable: boolean;
  onError: (message: string | null) => void;
}) {
  const [singleName, setSingleName] = createSignal("");
  const [bulkText, setBulkText] = createSignal("");
  const [editingId, setEditingId] = createSignal<Id<"participants"> | null>(null);
  const [draftName, setDraftName] = createSignal("");

  async function run(mutate: () => Promise<unknown>): Promise<boolean> {
    props.onError(null);
    try {
      await mutate();
      return true;
    } catch (error) {
      props.onError(errorMessage(error));
      return false;
    }
  }

  async function addSingle(event: SubmitEvent) {
    event.preventDefault();
    const ok = await run(() =>
      runMutation(api.operations.addParticipant, {
        tournamentId: props.view.tournamentId,
        name: singleName(),
      }),
    );
    if (ok) setSingleName("");
  }

  async function addBulk() {
    const ok = await run(() =>
      runMutation(api.operations.addParticipants, {
        tournamentId: props.view.tournamentId,
        text: bulkText(),
      }),
    );
    if (ok) setBulkText("");
  }

  function move(participantId: Id<"participants">, delta: -1 | 1) {
    const order = props.view.participants.map((participant) => participant.participantId);
    const index = order.indexOf(participantId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    void run(() =>
      runMutation(api.operations.reorderSeeding, {
        tournamentId: props.view.tournamentId,
        orderedParticipantIds: order,
      }),
    );
  }

  async function saveRename() {
    const participantId = editingId();
    if (participantId === null) return;
    const ok = await run(() =>
      runMutation(api.operations.renameParticipant, { participantId, name: draftName() }),
    );
    if (ok) setEditingId(null);
  }

  const rowButton =
    "rounded border border-ink-muted/40 bg-surface px-2 py-0.5 text-xs hover:border-accent disabled:opacity-40";

  return (
    <section class="flex max-w-2xl flex-col gap-3">
      <div class="flex flex-wrap items-baseline gap-3">
        <h2 class="font-display text-xl font-medium">{t("roster.heading")}</h2>
        <span class="text-sm text-ink-muted">
          {t("roster.count", { count: props.view.participants.length })}
        </span>
      </div>
      <p class="text-sm text-ink-muted">
        {props.editable
          ? props.view.seeding === "manual"
            ? t("seeding.manual")
            : t("seeding.random")
          : t("roster.locked", { status: t(`status.${props.view.status}`) })}
      </p>
      <ol class="flex flex-col gap-1">
        <For
          each={props.view.participants}
          keyed={(participant) => participant.participantId}
          fallback={<li class="text-sm text-ink-muted">{t("roster.empty")}</li>}
        >
          {(participant) => (
            <li class="flex items-center gap-2 rounded-md border border-ink-muted/20 bg-surface-raised px-3 py-1.5">
              <span class="w-6 shrink-0 text-right text-sm text-ink-muted">
                {participant().seed}
              </span>
              <Show
                when={editingId() === participant().participantId}
                fallback={<span class="min-w-0 flex-1 truncate">{participant().name}</span>}
              >
                <input
                  class="min-w-0 flex-1 rounded border border-ink-muted/40 bg-surface px-2 py-0.5 text-sm"
                  value={draftName()}
                  onInput={(event) => setDraftName(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveRename();
                    if (event.key === "Escape") setEditingId(null);
                  }}
                />
              </Show>
              <Show when={props.editable}>
                <span class="flex shrink-0 gap-1">
                  <Show
                    when={editingId() === participant().participantId}
                    fallback={
                      <>
                        <button
                          type="button"
                          class={rowButton}
                          aria-label={t("roster.moveUp")}
                          onClick={() => move(participant().participantId, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          class={rowButton}
                          aria-label={t("roster.moveDown")}
                          onClick={() => move(participant().participantId, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          class={rowButton}
                          onClick={() => {
                            setDraftName(participant().name);
                            setEditingId(participant().participantId);
                          }}
                        >
                          {t("roster.rename")}
                        </button>
                        <button
                          type="button"
                          class={rowButton}
                          onClick={() =>
                            void run(() =>
                              runMutation(api.operations.removeParticipant, {
                                participantId: participant().participantId,
                              }),
                            )
                          }
                        >
                          {t("roster.remove")}
                        </button>
                      </>
                    }
                  >
                    <button type="button" class={rowButton} onClick={() => void saveRename()}>
                      {t("roster.save")}
                    </button>
                    <button type="button" class={rowButton} onClick={() => setEditingId(null)}>
                      {t("roster.cancel")}
                    </button>
                  </Show>
                </span>
              </Show>
            </li>
          )}
        </For>
      </ol>
      <Show when={props.editable}>
        <form class="flex gap-2" onSubmit={(event) => void addSingle(event)}>
          <input
            class="min-w-0 flex-1 rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-1.5 text-sm"
            required
            value={singleName()}
            placeholder={t("roster.addPlaceholder")}
            onInput={(event) => setSingleName(event.currentTarget.value)}
          />
          <button
            type="submit"
            class="rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-1.5 text-sm hover:border-accent"
          >
            {t("roster.add")}
          </button>
        </form>
        <div class="flex flex-col gap-2">
          <textarea
            class="min-h-24 rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-1.5 text-sm"
            value={bulkText()}
            placeholder={t("roster.bulkPlaceholder")}
            onInput={(event) => setBulkText(event.currentTarget.value)}
          />
          <button
            type="button"
            class="self-start rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
            disabled={bulkText().trim() === ""}
            onClick={() => void addBulk()}
          >
            {t("roster.bulkAdd")}
          </button>
        </div>
      </Show>
    </section>
  );
}

type SettingsDraft = { name: string; discipline: string; family: FormatFamily };
type SettingsChanges = Omit<FunctionArgs<typeof api.operations.updateTournament>, "tournamentId">;

// Only what changed is sent. The format in particular is a structural
// change, so an unchanged family must not be re-submitted (its options would
// fall back to their defaults).
function settingsChanges(view: OrganizerView, draft: SettingsDraft): SettingsChanges {
  return {
    ...(draft.name.trim() !== view.name && { name: draft.name }),
    ...(draft.discipline.trim() !== view.discipline && { discipline: draft.discipline }),
    ...(draft.family !== view.format.family && { format: { family: draft.family } }),
  };
}

// Stories 26–27: the tournament's own record, and the way to remove it. The
// drafts are writable derivations of the server view, so a save — or an edit
// landing from another tab — resets them to the committed values.
function SettingsSection(props: { view: OrganizerView; formatEditable: boolean }) {
  const navigate = useNavigate();
  const [name, setName] = createSignal(() => props.view.name);
  const [discipline, setDiscipline] = createSignal(() => props.view.discipline);
  const [family, setFamily] = createSignal(() => props.view.format.family);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal(false);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);

  const changes = () =>
    settingsChanges(props.view, { name: name(), discipline: discipline(), family: family() });
  const dirty = () => Object.keys(changes()).length > 0;

  let savedTimer: ReturnType<typeof setTimeout> | undefined;

  async function save(event: SubmitEvent) {
    event.preventDefault();
    setSaveError(null);
    try {
      await runMutation(api.operations.updateTournament, {
        tournamentId: props.view.tournamentId,
        ...changes(),
      });
      setSaved(true);
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  }

  async function remove() {
    setDeleteError(null);
    try {
      await runMutation(api.operations.deleteTournament, {
        tournamentId: props.view.tournamentId,
      });
      navigate(Router.paths());
    } catch (error) {
      setDeleteError(errorMessage(error));
    }
  }

  const fieldClass = "rounded-md border border-ink-muted/40 bg-surface-raised px-3 py-2 text-base";
  const secondaryButton =
    "rounded-md border border-ink-muted/40 bg-surface px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50";

  return (
    <section class="flex max-w-xl flex-col gap-4">
      <h2 class="font-display text-xl font-medium">{t("settings.heading")}</h2>
      <form class="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-ink-muted">{t("home.create.name")}</span>
          <input
            class={fieldClass}
            required
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-ink-muted">{t("home.create.discipline")}</span>
          <DisciplineInput
            class={fieldClass}
            value={discipline()}
            onInput={(value) => setDiscipline(value)}
          />
        </label>
        <FormatFieldset
          value={family()}
          onChange={(next) => setFamily(next)}
          disabled={!props.formatEditable}
        />
        <p class="text-xs text-ink-muted">
          {props.formatEditable ? t("settings.formatHint") : t("settings.formatLocked")}
        </p>
        <Show when={saveError()}>{(message) => <ErrorNotice message={message()} />}</Show>
        <div class="flex items-center gap-3">
          <button
            type="submit"
            class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-50"
            disabled={!dirty()}
          >
            {t("settings.save")}
          </button>
          <Show when={saved()}>
            <span class="text-sm text-win">{t("settings.saved")}</span>
          </Show>
        </div>
      </form>

      <div class="flex flex-col gap-2 rounded-md border border-loss/40 p-3">
        <h3 class="text-sm font-medium text-loss">{t("settings.danger")}</h3>
        <p class="text-sm text-ink-muted">{t("settings.deleteHint")}</p>
        <Show
          when={confirmingDelete()}
          fallback={
            <button
              type="button"
              class={`${secondaryButton} self-start`}
              onClick={() => setConfirmingDelete(true)}
            >
              {t("settings.delete")}
            </button>
          }
        >
          <p class="text-sm">
            {t("settings.deleteConfirm", { count: props.view.participants.length })}
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-md bg-loss px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90"
              onClick={() => void remove()}
            >
              {t("settings.deleteConfirmAction")}
            </button>
            <button
              type="button"
              class={secondaryButton}
              onClick={() => setConfirmingDelete(false)}
            >
              {t("settings.deleteCancel")}
            </button>
          </div>
        </Show>
        <Show when={deleteError()}>{(message) => <ErrorNotice message={message()} />}</Show>
      </div>
    </section>
  );
}

type DecidedBy = "played" | "walkover" | "disqualification";

function resultSide(
  participantId: string,
  outcome: "win" | "loss" | "walkover" | "disqualification",
  score: number | undefined,
) {
  return {
    participantId: participantId as Id<"participants">,
    outcome,
    ...(score !== undefined && { score }),
  };
}

function ReportDialog(props: {
  match: OrganizerMatch;
  reportKey: string;
  participants: { participantId: Id<"participants">; name: string }[];
  onClose: () => void;
  onReported: (voidedCount: number) => void;
}) {
  function draftResetPerMatch<T>(initial: T) {
    return createSignal<T>((): T => {
      void props.reportKey;
      return initial;
    });
  }
  const [winnerId, setWinnerId] = draftResetPerMatch<string | null>(null);
  const [decidedBy, setDecidedBy] = draftResetPerMatch<DecidedBy>("played");
  const [scores, setScores] = draftResetPerMatch<Record<string, string>>({});
  const [formError, setFormError] = draftResetPerMatch<string | null>(null);

  const sideIds = () =>
    props.match.occupants.flatMap((occupant) =>
      occupant.kind === "participant" ? [occupant.participantId] : [],
    );
  const nameOf = (participantId: string) =>
    props.participants.find((participant) => participant.participantId === participantId)?.name ??
    participantId;

  function parsedScore(participantId: string): number | undefined {
    const raw = (scores()[participantId] ?? "").trim();
    if (raw === "") return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }

  async function report(winner: string, loser: string): Promise<number> {
    const decided = decidedBy();
    const result = await runMutation(api.operations.reportResult, {
      matchId: props.match.matchId,
      sides: [
        resultSide(winner, "win", parsedScore(winner)),
        resultSide(loser, decided === "played" ? "loss" : decided, parsedScore(loser)),
      ],
    });
    return result.voided.length;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const winner = winnerId();
    const loser = sideIds().find((id) => id !== winner);
    if (winner === null || loser === undefined) {
      setFormError(t("report.pickWinner"));
      return;
    }
    setFormError(null);
    try {
      props.onReported(await report(winner, loser));
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={() => props.onClose()}
    >
      <form
        class="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-ink-muted/30 bg-surface-raised p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <h3 class="font-display text-lg font-medium">
          {props.match.state === "completed" ? t("report.correct") : t("report.record")}
        </h3>
        <fieldset class="flex flex-col gap-2 text-sm">
          <legend class="pb-1 text-ink-muted">{t("report.winner")}</legend>
          <For each={sideIds()} keyed={(id) => id}>
            {(id) => (
              <div class="flex items-center gap-2">
                <label class="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="radio"
                    name="winner"
                    checked={winnerId() === id()}
                    onInput={() => setWinnerId(id())}
                  />
                  <span class="min-w-0 truncate">{nameOf(id())}</span>
                </label>
                <input
                  class="w-20 rounded border border-ink-muted/40 bg-surface px-2 py-1 text-right text-sm"
                  type="number"
                  inputmode="numeric"
                  placeholder={t("report.score")}
                  value={scores()[id()] ?? ""}
                  onInput={(event) => {
                    const value = event.currentTarget.value;
                    setScores((current) => ({ ...current, [id()]: value }));
                  }}
                />
              </div>
            )}
          </For>
        </fieldset>
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-ink-muted">{t("report.how")}</span>
          <select
            class="rounded-md border border-ink-muted/40 bg-surface px-2 py-1.5 text-sm"
            value={decidedBy()}
            onInput={(event) => setDecidedBy(event.currentTarget.value as DecidedBy)}
          >
            <option value="played">{t("report.how.played")}</option>
            <option value="walkover">{t("report.how.walkover")}</option>
            <option value="disqualification">{t("report.how.disqualification")}</option>
          </select>
        </label>
        <Show when={formError()}>{(message) => <ErrorNotice message={message()} />}</Show>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-ink-muted/40 bg-surface px-3 py-1.5 text-sm hover:border-accent"
            onClick={() => props.onClose()}
          >
            {t("report.cancel")}
          </button>
          <button
            type="submit"
            class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90"
          >
            {t("report.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
