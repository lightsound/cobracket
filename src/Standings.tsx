import { For, Show } from "solid-js";
import { t } from "./i18n";

interface StandingsProps {
  standings: { participantId: string; placement: number }[];
  participants: { participantId: string; name: string }[];
  championId?: string;
}

// Final standings + champion banner (stories 16 and 23), shared by the
// Organizer page and the Share Link page. The server derives placements;
// this only joins names on.
export function Standings(props: StandingsProps) {
  const nameOf = (participantId: string) =>
    props.participants.find((participant) => participant.participantId === participantId)?.name ??
    participantId;

  return (
    <section class="flex flex-col gap-3">
      <Show when={props.championId}>
        {(championId) => (
          <p class="rounded-lg border border-win/50 bg-surface-raised px-4 py-3 text-lg">
            <span class="mr-2 text-sm font-medium tracking-widest text-win uppercase">
              {t("champion.heading")}
            </span>
            <span class="font-display font-semibold text-win">{nameOf(championId())}</span>
          </p>
        )}
      </Show>
      <h3 class="font-display text-lg font-medium">{t("standings.heading")}</h3>
      <table class="w-full max-w-md text-sm">
        <thead>
          <tr class="border-b border-ink-muted/30 text-left text-xs text-ink-muted uppercase">
            <th class="py-1 pr-4 font-medium">{t("standings.placement")}</th>
            <th class="py-1 font-medium">{t("standings.participant")}</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.standings} keyed={(entry) => entry.participantId}>
            {(entry) => (
              <tr class="border-b border-ink-muted/15">
                <td class="py-1.5 pr-4 text-ink-muted">{entry().placement}</td>
                <td
                  class={[
                    "py-1.5",
                    { "font-semibold text-win": entry().participantId === props.championId },
                  ]}
                >
                  {nameOf(entry().participantId)}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </section>
  );
}
