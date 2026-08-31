import { Show } from "solid-js";
import type { Element } from "solid-js";
import { Standings } from "./Standings";
import { BracketView } from "./bracket/BracketView";
import type { ViewMatch } from "./bracket/BracketView";

interface BoardBracket {
  matches: ViewMatch[];
  readyMatchKeys: string[];
  voidedMatchKeys: string[];
  standings: { participantId: string; placement: number }[];
  championId?: string;
}

// The derived bracket state both surfaces render identically: the bracket
// itself, and — once completed — the champion and standings (stories 16,
// 23). The Organizer page adds result recording through onSelectMatch; the
// Share Link page leaves it off.
export function TournamentBoard(props: {
  bracket: BoardBracket | null;
  participants: { participantId: string; name: string }[];
  completed: boolean;
  fallback: Element;
  onSelectMatch?: (key: string) => void;
}) {
  return (
    <>
      <Show when={props.bracket} fallback={props.fallback}>
        {(bracket) => (
          <BracketView
            matches={bracket().matches}
            participants={props.participants}
            readyMatchKeys={bracket().readyMatchKeys}
            voidedMatchKeys={bracket().voidedMatchKeys}
            onSelectMatch={props.onSelectMatch}
          />
        )}
      </Show>
      <Show when={props.completed && props.bracket}>
        {(bracket) => (
          <Standings
            standings={bracket().standings}
            participants={props.participants}
            championId={bracket().championId}
          />
        )}
      </Show>
    </>
  );
}
