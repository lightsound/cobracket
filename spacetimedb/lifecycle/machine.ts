export type TournamentStatus = "draft" | "published" | "live" | "completed";

export type LifecycleEvent =
  | { type: "publish" }
  | { type: "editRoster" }
  | { type: "generateBracket" }
  | { type: "changeFormat" }
  | { type: "recordResult"; completesTournament: boolean };

export type LifecycleEventType = LifecycleEvent["type"];

export const TOURNAMENT_STATUSES: readonly TournamentStatus[] = [
  "draft",
  "published",
  "live",
  "completed",
];

export const LIFECYCLE_EVENT_TYPES: readonly LifecycleEventType[] = [
  "publish",
  "editRoster",
  "generateBracket",
  "changeFormat",
  "recordResult",
];

type SimpleEventType = Exclude<LifecycleEventType, "recordResult">;

const SIMPLE_TRANSITIONS: Record<
  SimpleEventType,
  Record<TournamentStatus, TournamentStatus | undefined>
> = {
  publish: {
    draft: "published",
    published: undefined,
    live: undefined,
    completed: undefined,
  },
  editRoster: {
    draft: "draft",
    published: "published",
    live: undefined,
    completed: undefined,
  },
  generateBracket: {
    draft: "draft",
    published: "published",
    live: undefined,
    completed: undefined,
  },
  changeFormat: {
    draft: "draft",
    published: "published",
    live: undefined,
    completed: undefined,
  },
};

const RECORD_RESULT_TRANSITIONS: Record<
  TournamentStatus,
  { completes: TournamentStatus | undefined; incomplete: TournamentStatus | undefined }
> = {
  draft: { completes: undefined, incomplete: undefined },
  published: { completes: "completed", incomplete: "live" },
  live: { completes: "completed", incomplete: "live" },
  completed: { completes: "completed", incomplete: undefined },
};

export function transitionStatus(
  status: TournamentStatus,
  event: LifecycleEvent,
): TournamentStatus | undefined {
  if (event.type === "recordResult") {
    const row = RECORD_RESULT_TRANSITIONS[status];
    return event.completesTournament ? row.completes : row.incomplete;
  }
  return SIMPLE_TRANSITIONS[event.type][status];
}

export function eventAllowed(status: TournamentStatus, eventType: LifecycleEventType): boolean {
  if (eventType === "recordResult") {
    const row = RECORD_RESULT_TRANSITIONS[status];
    return row.completes !== undefined || row.incomplete !== undefined;
  }
  return SIMPLE_TRANSITIONS[eventType][status] !== undefined;
}
