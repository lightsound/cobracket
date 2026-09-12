/**
 * Standings under the diagnostics gate (src/test-setup.ts). Same shape as the
 * bracket's: the rows arrive as a fresh array of fresh objects on every
 * subscription push, so the test drives that update and lets the gate assert
 * the table did not rebuild itself.
 */
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { expect, test } from "vite-plus/test";
import { setLocale } from "./i18n";
import { Standings, type StandingsProps } from "./Standings";

setLocale("en");

const PARTICIPANTS = [
  { participantId: "p1", name: "Ada" },
  { participantId: "p2", name: "Grace" },
  { participantId: "p3", name: "Alan" },
];

function placings(): StandingsProps["standings"] {
  return [
    { participantId: "p1", placement: 1 },
    { participantId: "p2", placement: 2 },
    { participantId: "p3", placement: 3 },
  ];
}

function mount(props: () => StandingsProps): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  render(() => <Standings {...props()} />, host);
  flush();
  return host;
}

function rows(host: HTMLElement): string[][] {
  return [...host.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => (cell.textContent ?? "").trim()),
  );
}

test("lists placements by participant name", () => {
  const host = mount(() => ({ standings: placings(), participants: PARTICIPANTS }));

  expect(rows(host)).toEqual([
    ["1", "Ada"],
    ["2", "Grace"],
    ["3", "Alan"],
  ]);
  // No champion yet — the banner is the tournament's completion, not first place.
  expect(host.querySelector("p")).toBeNull();
});

test("falls back to the participant id for a name it does not have", () => {
  const host = mount(() => ({
    standings: [{ participantId: "ghost", placement: 1 }],
    participants: PARTICIPANTS,
  }));

  expect(rows(host)).toEqual([["1", "ghost"]]);
});

test("keeps its rows across a refetch and shows the champion when one arrives", () => {
  const [championId, setChampionId] = createSignal<string | undefined>(undefined, {
    name: "champion",
  });
  const [standings, setStandings] = createSignal(placings(), { name: "standings" });
  const host = mount(() => ({
    standings: standings(),
    participants: PARTICIPANTS,
    championId: championId(),
  }));
  const firstRow = host.querySelector("tbody tr");

  setStandings(placings());
  setChampionId("p1");
  flush();

  expect(host.querySelector("tbody tr")).toBe(firstRow);
  expect(host.querySelector("p")?.textContent).toContain("Ada");
  // The kept row also updated: identity without reactivity would leave the
  // champion's cell unmarked, and the gate cannot see that — only this can.
  expect(firstRow?.querySelectorAll("td")[1]?.className).toContain("text-win");
});
