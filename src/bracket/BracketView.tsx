import { For, Show, createMemo, createSignal } from "solid-js";
import { t } from "../i18n";
import { CARD_HEIGHT, CARD_WIDTH, layoutBracket } from "./layout";
import type { BracketSectionName } from "./layout";

// The interactive bracket renderer (ADR 0007): absolutely positioned HTML
// Match cards from layoutBracket's serializable coordinates, connectors in
// one SVG overlay behind them, pan/zoom via transform. Shared by the
// Organizer page and the Share Link page — the Organizer passes
// onSelectMatch to open the result dialog; the public view leaves it off.

// The derived per-match view shape both operations reads return (the
// Organizer variant adds matchId, which flows through untouched).
/**
 * @public
 */
export type ViewOccupant =
  | { kind: "participant"; participantId: string }
  | { kind: "bye" }
  | { kind: "unknown" };

/**
 * @public
 */
export interface ViewResultSide {
  participantId: string;
  outcome: "win" | "loss" | "draw" | "walkover" | "disqualification";
  score?: number;
}

/**
 * @public
 */
export interface ViewMatch {
  key: string;
  bracket: BracketSectionName;
  round: number;
  indexInRound: number;
  state: "pending" | "ready" | "completed" | "cancelled";
  occupants: ViewOccupant[];
  winnerId?: string;
  loserId?: string;
  sides?: ViewResultSide[];
}

interface BracketViewProps {
  matches: ViewMatch[];
  participants: { participantId: string; name: string }[];
  readyMatchKeys: string[];
  voidedMatchKeys: string[];
  /** Organizer only: called with the match key of a reportable card. */
  onSelectMatch?: (key: string) => void;
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 1.6;
const SECTION_LABEL_SPACE = 32;
const CANVAS_PADDING = 24;

const SECTION_LABEL_KEYS = {
  winners: "bracket.section.winners",
  losers: "bracket.section.losers",
  grand_final: "bracket.section.grand_final",
} as const;

/**
 * @public
 */
export function BracketView(props: BracketViewProps) {
  const layout = createMemo(() => layoutBracket(props.matches));
  const matchByKey = createMemo(() => new Map(props.matches.map((match) => [match.key, match])));
  const nameOf = createMemo(
    () =>
      new Map(
        props.participants.map((participant) => [participant.participantId, participant.name]),
      ),
  );
  const readyKeys = createMemo(() => new Set(props.readyMatchKeys));
  const voidedKeys = createMemo(() => new Set(props.voidedMatchKeys));

  // Section labels only matter when there is more than one section
  // (double elimination); they earn the extra label band.
  // layoutBracket emits cards in (section, round, index) order, so the
  // first card of a section is its top row.
  const sections = createMemo(() => {
    const firstCards = new Map<BracketSectionName, { x: number; y: number }>();
    for (const card of layout().cards) {
      if (!firstCards.has(card.bracket)) firstCards.set(card.bracket, { x: card.x, y: card.y });
    }
    return [...firstCards].map(([bracket, position]) => ({ bracket, ...position }));
  });
  const labelSpace = () => (sections().length > 1 ? SECTION_LABEL_SPACE : 0);

  const [scale, setScale] = createSignal(1);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  let drag: {
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null = null;

  const zoomBy = (factor: number) =>
    setScale((current) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * factor)));

  const viewportHeight = () => Math.min(layout().height + labelSpace() + CANVAS_PADDING * 2, 620);

  return (
    <div
      class="relative overflow-hidden rounded-lg border border-ink-muted/30 bg-surface-raised select-none"
      style={{ height: `${viewportHeight()}px`, "touch-action": "none" }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          panX: pan().x,
          panY: pan().y,
        };
      }}
      onPointerMove={(event) => {
        const active = drag;
        if (active === null || event.pointerId !== active.pointerId) return;
        setPan({
          x: active.panX + event.clientX - active.startX,
          y: active.panY + event.clientY - active.startY,
        });
      }}
      onPointerUp={() => {
        drag = null;
      }}
      onPointerCancel={() => {
        drag = null;
      }}
    >
      <div
        style={{
          transform: `translate(${pan().x + CANVAS_PADDING}px, ${pan().y + CANVAS_PADDING}px) scale(${scale()})`,
          "transform-origin": "0 0",
          width: `${layout().width}px`,
          height: `${layout().height + labelSpace()}px`,
        }}
      >
        <svg
          class="absolute top-0 left-0"
          width={layout().width}
          height={layout().height + labelSpace()}
          aria-hidden="true"
        >
          <For each={layout().edges} keyed={(edge) => `${edge.fromKey}>${edge.toKey}:${edge.kind}`}>
            {(edge) => {
              const path = () => {
                const from = { x: edge().from.x, y: edge().from.y + labelSpace() };
                const to = { x: edge().to.x, y: edge().to.y + labelSpace() };
                if (edge().kind === "winner") {
                  const midX = (from.x + to.x) / 2;
                  return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
                }
                return `M ${from.x} ${from.y} C ${from.x} ${from.y + 36}, ${to.x} ${to.y - 36}, ${to.x} ${to.y}`;
              };
              return (
                <path
                  d={path()}
                  fill="none"
                  class={["stroke-ink-muted/60", { "stroke-loss/50": edge().kind === "loser" }]}
                  stroke-width="1.5"
                  stroke-dasharray={edge().kind === "loser" ? "4 4" : undefined}
                />
              );
            }}
          </For>
        </svg>
        <Show when={sections().length > 1}>
          <For each={sections()} keyed={(section) => section.bracket}>
            {(section) => (
              <span
                class="absolute text-xs font-display font-medium tracking-widest uppercase text-ink-muted"
                style={{
                  transform: `translate(${section().x}px, ${section().y + labelSpace() - 26}px)`,
                }}
              >
                {t(SECTION_LABEL_KEYS[section().bracket])}
              </span>
            )}
          </For>
        </Show>
        <For each={layout().cards} keyed={(card) => card.key}>
          {(card) => (
            <Show when={matchByKey().get(card().key)}>
              {(match) => (
                <MatchCard
                  match={match()}
                  x={card().x}
                  y={card().y + labelSpace()}
                  ready={readyKeys().has(card().key)}
                  voided={voidedKeys().has(card().key)}
                  names={nameOf()}
                  onSelect={props.onSelectMatch}
                />
              )}
            </Show>
          )}
        </For>
      </div>
      <div class="absolute top-2 right-2 flex gap-1">
        <ZoomButton label={t("bracket.zoomOut")} onClick={() => zoomBy(1 / 1.25)}>
          −
        </ZoomButton>
        <ZoomButton
          label={t("bracket.zoomReset")}
          onClick={() => {
            setScale(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          ⤾
        </ZoomButton>
        <ZoomButton label={t("bracket.zoomIn")} onClick={() => zoomBy(1.25)}>
          +
        </ZoomButton>
      </div>
    </div>
  );
}

function ZoomButton(props: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      class="h-8 w-8 rounded-md border border-ink-muted/40 bg-surface text-ink hover:border-accent"
      aria-label={props.label}
      title={props.label}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  );
}

// Ready matches take a result; completed matches between two participants
// take a correction (story 14). Everything else is display-only.
function isReportable(match: ViewMatch): boolean {
  if (match.state === "ready") return true;
  return (
    match.state === "completed" &&
    match.occupants.length === 2 &&
    match.occupants.every((occupant) => occupant.kind === "participant")
  );
}

function MatchCard(props: {
  match: ViewMatch;
  x: number;
  y: number;
  ready: boolean;
  voided: boolean;
  names: Map<string, string>;
  onSelect?: (key: string) => void;
}) {
  const reportable = () => props.onSelect !== undefined && isReportable(props.match);

  return (
    <button
      type="button"
      disabled={!reportable()}
      class={[
        "absolute flex flex-col justify-center gap-1 rounded-md border-2 bg-surface px-2 py-1 text-left text-sm",
        {
          "border-live shadow-sm": props.ready && !props.voided,
          "border-loss": props.voided,
          "border-ink-muted/30": !props.ready && !props.voided,
          "border-dashed opacity-70": props.match.state === "pending",
          "opacity-40": props.match.state === "cancelled",
          "cursor-pointer hover:border-accent": reportable(),
          "cursor-default": !reportable(),
        },
      ]}
      style={{
        transform: `translate(${props.x}px, ${props.y}px)`,
        width: `${CARD_WIDTH}px`,
        height: `${CARD_HEIGHT}px`,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => {
        if (reportable()) props.onSelect?.(props.match.key);
      }}
    >
      <Show when={props.ready && !props.voided}>
        <span class="absolute -top-2.5 left-2 rounded bg-live px-1 text-xs font-medium text-surface">
          {t("bracket.ready")}
        </span>
      </Show>
      <Show when={props.voided}>
        <span class="absolute -top-2.5 left-2 rounded bg-loss px-1 text-xs font-medium text-surface">
          {t("bracket.voided")}
        </span>
      </Show>
      <OccupantRow occupant={props.match.occupants[0]} match={props.match} names={props.names} />
      <OccupantRow occupant={props.match.occupants[1]} match={props.match} names={props.names} />
    </button>
  );
}

function OccupantRow(props: {
  occupant?: ViewOccupant;
  match: ViewMatch;
  names: Map<string, string>;
}) {
  const participantId = () => {
    const occupant = props.occupant;
    return occupant !== undefined && occupant.kind === "participant"
      ? occupant.participantId
      : null;
  };
  const side = () => {
    const id = participantId();
    if (id === null) return undefined;
    return props.match.sides?.find((entry) => entry.participantId === id);
  };
  const isWinner = () => {
    const id = participantId();
    return id !== null && props.match.winnerId === id;
  };
  const isLoser = () => {
    const id = participantId();
    return id !== null && props.match.loserId === id;
  };
  const isPlaceholder = () => {
    const id = participantId();
    return id === null;
  };
  const outcomeBadge = () => {
    const outcome = side()?.outcome;
    if (outcome === "walkover") return t("outcome.walkover");
    if (outcome === "disqualification") return t("outcome.disqualification");
    return null;
  };
  const scoreLabel = () => {
    const entry = side();
    if (entry === undefined || entry.score === undefined) return null;
    return String(entry.score);
  };

  return (
    <span class="flex min-w-0 items-center gap-1">
      <span
        class={[
          "min-w-0 flex-1 truncate",
          {
            "font-semibold text-win": isWinner(),
            "text-ink-muted": isLoser(),
            "text-ink-muted italic": isPlaceholder(),
          },
        ]}
      >
        <Show when={props.occupant} fallback={t("bracket.tbd")}>
          {(occupant) => {
            const label = () => {
              const value = occupant();
              if (value.kind === "participant") {
                return props.names.get(value.participantId) ?? value.participantId;
              }
              return value.kind === "bye" ? t("bracket.bye") : t("bracket.tbd");
            };
            return <>{label()}</>;
          }}
        </Show>
      </span>
      <Show when={outcomeBadge()}>
        {(badge) => <span class="shrink-0 text-xs text-ink-muted uppercase">{badge()}</span>}
      </Show>
      <Show when={scoreLabel()}>
        {(score) => (
          <span
            class={["shrink-0 text-sm", { "text-win": isWinner(), "text-ink-muted": !isWinner() }]}
          >
            {score()}
          </span>
        )}
      </Show>
    </span>
  );
}
