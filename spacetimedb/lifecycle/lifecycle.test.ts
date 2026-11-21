import { describe, expect, test } from "vite-plus/test";
import { eventAllowed, transitionStatus } from "./index";
import type { LifecycleEvent, LifecycleEventType, TournamentStatus } from "./index";
import { LIFECYCLE_EVENT_TYPES, TOURNAMENT_STATUSES } from "./machine";

const publish: LifecycleEvent = { type: "publish" };
const editRoster: LifecycleEvent = { type: "editRoster" };
const generateBracket: LifecycleEvent = { type: "generateBracket" };
const changeFormat: LifecycleEvent = { type: "changeFormat" };
const recordIncomplete: LifecycleEvent = { type: "recordResult", completesTournament: false };
const recordComplete: LifecycleEvent = { type: "recordResult", completesTournament: true };

const TRANSITION_EXPECTATIONS: readonly [
  TournamentStatus,
  LifecycleEvent,
  TournamentStatus | undefined,
][] = [
  ["draft", publish, "published"],
  ["draft", editRoster, "draft"],
  ["draft", generateBracket, "draft"],
  ["draft", changeFormat, "draft"],
  ["draft", recordIncomplete, undefined],
  ["draft", recordComplete, undefined],
  ["published", publish, undefined],
  ["published", editRoster, "published"],
  ["published", generateBracket, "published"],
  ["published", changeFormat, "published"],
  ["published", recordIncomplete, "live"],
  ["published", recordComplete, "completed"],
  ["live", publish, undefined],
  ["live", editRoster, undefined],
  ["live", generateBracket, undefined],
  ["live", changeFormat, undefined],
  ["live", recordIncomplete, "live"],
  ["live", recordComplete, "completed"],
  ["completed", publish, undefined],
  ["completed", editRoster, undefined],
  ["completed", generateBracket, undefined],
  ["completed", changeFormat, undefined],
  ["completed", recordIncomplete, undefined],
  ["completed", recordComplete, "completed"],
];

const ALLOWED_EXPECTATIONS: Record<TournamentStatus, Record<LifecycleEventType, boolean>> = {
  draft: {
    publish: true,
    editRoster: true,
    generateBracket: true,
    changeFormat: true,
    recordResult: false,
  },
  published: {
    publish: false,
    editRoster: true,
    generateBracket: true,
    changeFormat: true,
    recordResult: true,
  },
  live: {
    publish: false,
    editRoster: false,
    generateBracket: false,
    changeFormat: false,
    recordResult: true,
  },
  completed: {
    publish: false,
    editRoster: false,
    generateBracket: false,
    changeFormat: false,
    recordResult: true,
  },
};

describe("lifecycle transition table", () => {
  test("transitionStatus matches the hand-authored matrix for all 24 cells", () => {
    expect(TRANSITION_EXPECTATIONS).toHaveLength(24);
    for (const [status, event, expected] of TRANSITION_EXPECTATIONS) {
      expect(transitionStatus(status, event), `${status} + ${JSON.stringify(event)}`).toBe(
        expected,
      );
    }
  });

  test("eventAllowed matches its hand-authored matrix for all 20 pairs", () => {
    let checked = 0;
    for (const status of Object.keys(ALLOWED_EXPECTATIONS) as TournamentStatus[]) {
      for (const eventType of Object.keys(ALLOWED_EXPECTATIONS[status]) as LifecycleEventType[]) {
        expect(eventAllowed(status, eventType), `${status} + ${eventType}`).toBe(
          ALLOWED_EXPECTATIONS[status][eventType],
        );
        checked += 1;
      }
    }
    expect(checked).toBe(20);
  });

  test("the enumerations list exactly the expected members", () => {
    expect([...TOURNAMENT_STATUSES]).toEqual(["draft", "published", "live", "completed"]);
    expect([...LIFECYCLE_EVENT_TYPES]).toEqual([
      "publish",
      "editRoster",
      "generateBracket",
      "changeFormat",
      "recordResult",
    ]);
  });
});
