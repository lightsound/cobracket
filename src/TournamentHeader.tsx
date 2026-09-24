import type { Element } from "solid-js";
import { StatusBadge, type TournamentStatus } from "./StatusBadge";
import { useI18n } from "./i18n";

export function TournamentHeader(props: {
  name: string;
  status: TournamentStatus;
  discipline: string;
  formatFamily: "single_elimination" | "double_elimination";
  children?: Element;
}) {
  const { t } = useI18n();

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
