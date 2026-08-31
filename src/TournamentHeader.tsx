import type { Element } from "solid-js";
import { StatusBadge, type TournamentStatus } from "./StatusBadge";
import { t } from "./i18n";

// The tournament identity block, shared by the Organizer page and the Share
// Link page (both render the same derived view). Extra rows (e.g. the
// Organizer's Share Link controls) come in as children.
export function TournamentHeader(props: {
  name: string;
  status: TournamentStatus;
  discipline: string;
  formatFamily: "single_elimination" | "double_elimination";
  children?: Element;
}) {
  return (
    <header class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="font-display text-2xl font-medium">{props.name}</h1>
        <StatusBadge status={props.status} />
      </div>
      <p class="text-sm text-ink-muted">
        {props.discipline} · {t(`format.${props.formatFamily}`)}
      </p>
      {props.children}
    </header>
  );
}
