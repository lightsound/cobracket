import { useParams } from "@solidjs/router";
import { Portal } from "@solidjs/web";
import { Errored, For, Loading, Show, createSignal } from "solid-js";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ErrorNotice, errorFallback, errorMessage } from "../ErrorFallback";
import { SetupNotice } from "../SetupNotice";
import { TournamentBoard } from "../TournamentBoard";
import { TournamentHeader } from "../TournamentHeader";
import { t } from "../i18n";
import { createConvexQuery, getConvexUrl, runMutation } from "../lib/convex";
// fallow-ignore-next-line circular-dependency -- the official Solid Router 2 shape: the router lazy-imports pages (deferred dynamic import), pages link back through Router.paths; no init-order hazard
import { Router } from "../router";

type OrganizerView = FunctionReturnType<typeof api.operations.getTournament>;
type OrganizerMatch = NonNullable<OrganizerView["bracket"]>["matches"][number];

// The Organizer management surface (stories 4-17): roster, seeding, bracket
// generation, publishing, result recording, and the Share Link. Everything
// rendered here is the server's derived view — no progression logic lives
// on the client (ADR 0005).
export default function TournamentPage() {
  if (!getConvexUrl()) return <SetupNotice />;
  const params = useParams(Router.paths.t);
  const view = createConvexQuery(api.operations.getTournament, () => ({
    tournamentId: params.tournamentId as Id<"tournaments">,
  }));

  return (
    <Errored fallback={errorFallback}>
      <Loading fallback={<p class="text-sm text-ink-muted">{t("app.loading")}</p>}>
        <Manager view={view()} />
      </Loading>
    </Errored>
  );
}

function bracketPlaceholder(view: OrganizerView): string {
  if (view.participants.length < 2) return t("bracket.needTwo");
  return view.status === "published" ? t("bracket.stale") : t("bracket.none");
}

function Manager(props: { view: OrganizerView }) {
  const [actionError, setActionError] = createSignal<string | null>(null);
  // Set from reportResult's return value (story 14): how many downstream
  // results this correction voided. The affected matches are ALSO badged
  // through voidedMatchKeys; this is the immediate confirmation.
  const [voidedCount, setVoidedCount] = createSignal(0);
  const [reportKey, setReportKey] = createSignal<string | null>(null);

  // Roster and seeding stay editable, and the bracket regenerable, until the
  // first result flips the tournament to live.
  const editable = () => props.view.status === "draft" || props.view.status === "published";
  // Results are recorded from published on (the first one flips to live).
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
  onError: (message: string) => void;
}) {
  const canPublish = () => props.view.status === "draft" && props.view.bracket !== null;

  async function run(mutate: () => Promise<unknown>): Promise<void> {
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
  const [copied, setCopied] = createSignal(false);
  const shareUrl = () => `${window.location.origin}${Router.paths.s(props.shareSlug)()}`;

  async function copy() {
    await navigator.clipboard.writeText(shareUrl());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          {copied() ? t("tournament.share.copied") : t("tournament.share.copy")}
        </button>
      </div>
      <p class="text-xs text-ink-muted">{t("tournament.share.hint")}</p>
    </div>
  );
}

function RosterSection(props: {
  view: OrganizerView;
  editable: boolean;
  onError: (message: string) => void;
}) {
  const [singleName, setSingleName] = createSignal("");
  const [bulkText, setBulkText] = createSignal("");
  const [editingId, setEditingId] = createSignal<Id<"participants"> | null>(null);
  const [draftName, setDraftName] = createSignal("");

  async function run(mutate: () => Promise<unknown>): Promise<boolean> {
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

  // Manual reorder (story 8): swap two neighbors and pin the whole order.
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
  /** The stable key of the match being reported: form state resets on it. */
  reportKey: string;
  participants: { participantId: Id<"participants">; name: string }[];
  onClose: () => void;
  onReported: (voidedCount: number) => void;
}) {
  // Form state resets when the dialog targets a different match; realtime
  // view updates for the SAME match leave the draft alone.
  const [winnerId, setWinnerId] = createSignal<string | null>(() => {
    void props.reportKey;
    return null;
  });
  const [decidedBy, setDecidedBy] = createSignal<DecidedBy>((): DecidedBy => {
    void props.reportKey;
    return "played";
  });
  const [scores, setScores] = createSignal<Record<string, string>>(() => {
    void props.reportKey;
    return {};
  });
  const [formError, setFormError] = createSignal<string | null>(() => {
    void props.reportKey;
    return null;
  });

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

  // Outcome pairs the engine accepts: the winner records "win"; the other
  // side records how it lost (loss, walkover, or disqualification).
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
