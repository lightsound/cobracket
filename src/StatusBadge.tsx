import { t } from "./i18n";

export type TournamentStatus = "draft" | "published" | "live" | "completed";

const STATUS_KEYS = {
  draft: "status.draft",
  published: "status.published",
  live: "status.live",
  completed: "status.completed",
} as const satisfies Record<TournamentStatus, string>;

// One badge for the lifecycle everywhere a status appears, so the
// state-to-color mapping cannot drift between pages.
export function StatusBadge(props: { status: TournamentStatus }) {
  return (
    <span
      class={[
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        {
          "border-ink-muted/40 text-ink-muted": props.status === "draft",
          "border-accent/60 text-accent": props.status === "published",
          "border-live/60 text-live": props.status === "live",
          "border-win/60 text-win": props.status === "completed",
        },
      ]}
    >
      {t(STATUS_KEYS[props.status])}
    </span>
  );
}
