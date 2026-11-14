import { describe, expect, it } from "vitest";
import type {
  MyTournamentRow,
  OrganizerMatchRow,
  OrganizerParticipantRow,
  OrganizerResultRow,
  OrganizerTournamentRow,
  SharedMatchRow,
  SharedResultRow,
  SharedTournamentRow,
} from "../../spacetimedb/bindings/types";
import type { Outcome } from "./operations";
import type { TournamentKnowledge } from "./spacetimedb-model";
import {
  composeCurrentOrganizer,
  composeMyTournaments,
  composeOrganizerTournament,
  composeSessionState,
  composeSharedTournament,
  filterSuggestions,
  formatArgToBinding,
  formatToContract,
  normalizeDisciplineName,
  parseBulkNames,
  statusToContract,
  synthesizeAddedParticipants,
  synthesizeCreated,
  synthesizeReport,
  validateWrite,
} from "./spacetimedb-model";
import type { KnownState } from "./spacetimedb-model";

// The adapter's pure layer, pinned: compositions turn binding rows
// into the seam's contract shapes, and the pre-validator mirrors the
// module's guard texts exactly (the error channel — see
// spacetimedb-model.ts's header). Fixtures are binding rows as the
// generated types define them.

const SINGLE = { tag: "SingleElimination" } as const;
const PUBLISHED = { tag: "Published" } as const;

function participant(id: bigint, name: string, seed: number): OrganizerParticipantRow {
  return { participantId: id, name, seed };
}

function slotParticipant(id: bigint) {
  return { tag: "Participant", value: { participantId: id } } as const;
}

function slotWinnerOf(matchKey: string) {
  return { tag: "WinnerOf", value: { matchKey } } as const;
}

const HEADER: OrganizerTournamentRow = {
  tournamentId: 7n,
  name: "Spring Cup",
  status: PUBLISHED,
  format: SINGLE,
  discipline: "Chess",
  shareSlug: "spring-cup-7",
  seeding: { tag: "Random" },
};

const ROSTER = [
  participant(11n, "Alice", 1),
  participant(12n, "Bob", 2),
  participant(13n, "Carol", 3),
  participant(14n, "Dave", 4),
];

const MATCHES: OrganizerMatchRow[] = [
  {
    matchId: 21n,
    key: "W-R1-M1",
    bracket: { tag: "Winners" },
    round: 1,
    indexInRound: 0,
    slots: [slotParticipant(11n), slotParticipant(14n)],
  },
  {
    matchId: 22n,
    key: "W-R1-M2",
    bracket: { tag: "Winners" },
    round: 1,
    indexInRound: 1,
    slots: [slotParticipant(12n), slotParticipant(13n)],
  },
  {
    matchId: 23n,
    key: "W-R2-M1",
    bracket: { tag: "Winners" },
    round: 2,
    indexInRound: 0,
    slots: [slotWinnerOf("W-R1-M1"), slotWinnerOf("W-R1-M2")],
  },
];

function resultRow(matchId: bigint, resultId: bigint, a: bigint, b: bigint): OrganizerResultRow {
  return {
    matchId,
    resultId,
    sides: [
      { participantId: a, outcome: { tag: "Win" }, score: undefined },
      { participantId: b, outcome: { tag: "Loss" }, score: undefined },
    ],
  };
}

function knowledgeOf(overrides: Partial<TournamentKnowledge> = {}): TournamentKnowledge {
  const composed = composeOrganizerTournament({
    header: HEADER,
    participants: ROSTER,
    matches: MATCHES,
    results: [],
  });
  return { ...composed.knowledge!, ...overrides };
}

function stateWith(
  knowledge: TournamentKnowledge,
  session: KnownState["session"] = { kind: "organizer", userId: "5" },
): KnownState {
  return {
    session,
    tournaments: new Map([["7", knowledge]]),
    participantHome: new Map(knowledge.participants.map((p) => [p.participantId, "7"])),
    matchHome: new Map([...knowledge.matchKeyById].map(([id]) => [id, "7"])),
  };
}

const EMPTY_STATE: KnownState = {
  session: { kind: "unauthenticated" },
  tournaments: new Map(),
  participantHome: new Map(),
  matchHome: new Map(),
};

describe("row mappings", () => {
  it("maps statuses and formats between binding and contract shapes", () => {
    expect(statusToContract({ tag: "Draft" })).toBe("draft");
    expect(statusToContract({ tag: "Live" })).toBe("live");
    expect(formatToContract(SINGLE)).toEqual({ family: "single_elimination" });
    expect(
      formatToContract({ tag: "DoubleElimination", value: { grandFinalReset: false } }),
    ).toEqual({ family: "double_elimination", grandFinalReset: false });
    expect(formatArgToBinding({ family: "double_elimination" })).toEqual({
      tag: "DoubleElimination",
      value: { grandFinalReset: true },
    });
    expect(formatArgToBinding({ family: "single_elimination" })).toEqual({
      tag: "SingleElimination",
    });
  });

  it("orders my tournaments newest first and stringifies ids", () => {
    const row = (id: bigint, name: string): MyTournamentRow => ({
      tournamentId: id,
      name,
      status: { tag: "Draft" },
      format: SINGLE,
      discipline: "Chess",
      shareSlug: `slug-${id}`,
    });
    const summaries = composeMyTournaments([row(3n, "C"), row(9n, "A"), row(5n, "B")]);
    expect(summaries.map((s) => s.tournamentId)).toEqual(["9", "5", "3"]);
    expect(summaries[0]).toEqual({
      tournamentId: "9",
      name: "A",
      status: "draft",
      format: { family: "single_elimination" },
      discipline: "Chess",
      shareSlug: "slug-9",
    });
  });

  it("composes the session state and the current organizer", () => {
    expect(composeSessionState(undefined)).toEqual({ kind: "unauthenticated" });
    expect(composeSessionState({ state: { tag: "UserMissing" } })).toEqual({
      kind: "user_missing",
    });
    expect(composeSessionState({ state: { tag: "Organizer", value: { userId: 42n } } })).toEqual({
      kind: "organizer",
      userId: "42",
    });
    expect(composeCurrentOrganizer(undefined)).toBeNull();
    expect(composeCurrentOrganizer({ userId: 42n })).toBe("42");
  });

  it("normalizes discipline names the module's way", () => {
    expect(normalizeDisciplineName("  Table   Tennis ")).toEqual({
      name: "Table Tennis",
      normalizedName: "table tennis",
    });
  });
});

describe("suggestion filtering", () => {
  const rows = [{ name: "Chess" }, { name: "Chess Boxing" }, { name: "Checkers" }, { name: "Go" }];

  it("applies the view's prefix rule to a merged cache superset", () => {
    expect(filterSuggestions(rows, "che")).toEqual(["Checkers", "Chess", "Chess Boxing"]);
    expect(filterSuggestions(rows, "  CHE ")).toEqual(["Checkers", "Chess", "Chess Boxing"]);
    expect(filterSuggestions(rows, "")).toEqual([]);
    expect(filterSuggestions(rows, "xyz")).toEqual([]);
  });

  it("caps at ten in normalized order", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      name: `Sport ${String(i).padStart(2, "0")}`,
    }));
    expect(filterSuggestions(many, "sport")).toHaveLength(10);
    expect(filterSuggestions(many, "sport")[0]).toBe("Sport 00");
  });
});

describe("tournament composition", () => {
  it("composes the organizer view with a null bracket before generation", () => {
    const { view, knowledge } = composeOrganizerTournament({
      header: HEADER,
      participants: [ROSTER[2]!, ROSTER[0]!, ROSTER[3]!, ROSTER[1]!],
      matches: [],
      results: [],
    });
    expect(view).not.toBeNull();
    expect(view!.participants.map((p) => p.name)).toEqual(["Alice", "Bob", "Carol", "Dave"]);
    expect(view!.bracket).toBeNull();
    expect(view!.seeding).toBe("random");
    expect(knowledge!.matchCount).toBe(0);
  });

  it("derives the progression from structure plus recorded results", () => {
    const { view, knowledge } = composeOrganizerTournament({
      header: HEADER,
      participants: ROSTER,
      matches: MATCHES,
      results: [resultRow(21n, 31n, 11n, 14n)],
    });
    const bracket = view!.bracket!;
    expect(bracket.matches).toHaveLength(3);
    const first = bracket.matches.find((m) => m.key === "W-R1-M1")!;
    expect(first.state).toBe("completed");
    expect(first.winnerId).toBe("11");
    expect(first.matchId).toBe("21");
    const final = bracket.matches.find((m) => m.key === "W-R2-M1")!;
    expect(final.occupants[0]).toEqual({ kind: "participant", participantId: "11" });
    expect(bracket.readyMatchKeys).toEqual(["W-R1-M2"]);
    expect(knowledge!.resultCount).toBe(1);
    expect(knowledge!.matchKeyById.get("21")).toBe("W-R1-M1");
  });

  it("returns null for a tournament the caller does not own", () => {
    const { view, knowledge } = composeOrganizerTournament({
      header: undefined,
      participants: [],
      matches: [],
      results: [],
    });
    expect(view).toBeNull();
    expect(knowledge).toBeNull();
  });

  it("composes the shared view from slug-keyed rows", () => {
    const header: SharedTournamentRow = {
      name: "Spring Cup",
      status: PUBLISHED,
      format: SINGLE,
      discipline: "Chess",
    };
    const matches: SharedMatchRow[] = MATCHES.map((m) => ({
      key: m.key,
      bracket: m.bracket,
      round: m.round,
      indexInRound: m.indexInRound,
      slots: [...m.slots],
    }));
    const results: SharedResultRow[] = [
      {
        matchKey: "W-R1-M1",
        seq: 1n,
        sides: [
          { participantId: 11n, outcome: { tag: "Win" }, score: undefined },
          { participantId: 14n, outcome: { tag: "Loss" }, score: undefined },
        ],
      },
    ];
    const view = composeSharedTournament({
      header,
      participants: ROSTER,
      matches: [matches[2]!, matches[0]!, matches[1]!],
      results,
    });
    expect(view!.bracket!.matches.map((m) => m.key)).toEqual(["W-R1-M1", "W-R1-M2", "W-R2-M1"]);
    expect(view!.bracket!.matches[0]!.winnerId).toBe("11");
    expect("matchId" in view!.bracket!.matches[0]!).toBe(false);
  });
});

describe("pre-validation", () => {
  it("refuses every write for a dead session, with the module's text", () => {
    const state = stateWith(knowledgeOf(), { kind: "user_missing" });
    expect(
      validateWrite(
        "createTournament",
        { name: "X", discipline: "Y", format: { family: "single_elimination" } },
        state,
      ),
    ).toBe("Not signed in");
    expect(validateWrite("deleteTournament", { tournamentId: "7" }, state)).toBe("Not signed in");
  });

  it("checks create's names in the module's order", () => {
    const base = { discipline: "Chess", format: { family: "single_elimination" } as const };
    expect(validateWrite("createTournament", { ...base, name: "  " }, EMPTY_STATE)).toBe(
      "Tournament name must not be empty",
    );
    expect(validateWrite("createTournament", { ...base, name: "x".repeat(121) }, EMPTY_STATE)).toBe(
      "Tournament name must be at most 120 characters",
    );
    expect(
      validateWrite(
        "createTournament",
        { name: "Cup", discipline: " ", format: base.format },
        EMPTY_STATE,
      ),
    ).toBe("Discipline must not be empty");
    expect(
      validateWrite(
        "createTournament",
        { name: "Cup", discipline: "Chess", format: base.format },
        EMPTY_STATE,
      ),
    ).toBeNull();
  });

  it("refuses roster edits on a live tournament before checking names", () => {
    const live = knowledgeOf({ status: "live" });
    const state = stateWith(live);
    expect(validateWrite("addParticipant", { tournamentId: "7", name: "" }, state)).toBe(
      "Cannot edit the roster: the tournament is live",
    );
    expect(validateWrite("renameParticipant", { participantId: "11", name: "Zed" }, state)).toBe(
      "Cannot edit the roster: the tournament is live",
    );
  });

  it("checks capacity before the participant name, as the reducer does", () => {
    const full = knowledgeOf({
      participants: Array.from({ length: 128 }, (_, i) => ({
        participantId: String(100 + i),
        name: `P${i}`,
        seed: i + 1,
      })),
    });
    expect(validateWrite("addParticipant", { tournamentId: "7", name: "" }, stateWith(full))).toBe(
      "A tournament can have at most 128 participants",
    );
  });

  it("parses bulk names and refuses an empty batch", () => {
    expect(parseBulkNames(" A \n\nB\r\n C ")).toEqual(["A", "B", "C"]);
    const state = stateWith(knowledgeOf());
    expect(validateWrite("addParticipants", { tournamentId: "7", text: " \n " }, state)).toBe(
      "No participant names given",
    );
    expect(
      validateWrite(
        "addParticipants",
        { tournamentId: "7", text: `Ok\n${"x".repeat(121)}` },
        state,
      ),
    ).toBe("Participant name must be at most 120 characters");
    expect(
      validateWrite("addParticipants", { tournamentId: "7", text: "Eve\nFrank" }, state),
    ).toBeNull();
  });

  it("validates the seeding set equality", () => {
    const state = stateWith(knowledgeOf());
    expect(
      validateWrite(
        "reorderSeeding",
        { tournamentId: "7", orderedParticipantIds: ["11", "12", "13"] },
        state,
      ),
    ).toBe("The new order must contain every participant exactly once");
    expect(
      validateWrite(
        "reorderSeeding",
        { tournamentId: "7", orderedParticipantIds: ["14", "13", "12", "11"] },
        state,
      ),
    ).toBeNull();
  });

  it("guards bracket generation and publishing", () => {
    const one = knowledgeOf({
      participants: [{ participantId: "11", name: "Alice", seed: 1 }],
    });
    expect(validateWrite("generateBracket", { tournamentId: "7" }, stateWith(one))).toBe(
      "At least two participants are required to generate a bracket",
    );
    const noMatches = knowledgeOf({ matchCount: 0 });
    expect(validateWrite("publishTournament", { tournamentId: "7" }, stateWith(noMatches))).toBe(
      "Cannot publish: the tournament is published",
    );
    const draft = knowledgeOf({ status: "draft", matchCount: 0 });
    expect(validateWrite("publishTournament", { tournamentId: "7" }, stateWith(draft))).toBe(
      "Generate the bracket before publishing",
    );
    const ready = knowledgeOf({ status: "draft" });
    expect(validateWrite("publishTournament", { tournamentId: "7" }, stateWith(ready))).toBeNull();
  });

  it("refuses a format change once live, allows it while draft", () => {
    const live = stateWith(knowledgeOf({ status: "live" }));
    expect(
      validateWrite(
        "updateTournament",
        { tournamentId: "7", format: { family: "double_elimination" } },
        live,
      ),
    ).toBe("Cannot change the format: the tournament is live");
    const draft = stateWith(knowledgeOf({ status: "draft" }));
    expect(
      validateWrite(
        "updateTournament",
        { tournamentId: "7", format: { family: "double_elimination" } },
        draft,
      ),
    ).toBeNull();
    // The same format is not a change, even live.
    expect(
      validateWrite(
        "updateTournament",
        { tournamentId: "7", format: { family: "single_elimination" } },
        live,
      ),
    ).toBeNull();
  });

  it("checks an update's discipline before its format, as the reducer does", () => {
    const live = stateWith(knowledgeOf({ status: "live" }));
    expect(validateWrite("updateTournament", { tournamentId: "7", discipline: "   " }, live)).toBe(
      "Discipline must not be empty",
    );
    expect(
      validateWrite(
        "updateTournament",
        { tournamentId: "7", discipline: "", format: { family: "double_elimination" } },
        live,
      ),
    ).toBe("Discipline must not be empty");
    expect(
      validateWrite("updateTournament", { tournamentId: "7", discipline: " Go " }, live),
    ).toBeNull();
  });

  it("decides nothing for tournaments it holds no state for", () => {
    expect(validateWrite("publishTournament", { tournamentId: "999" }, EMPTY_STATE)).toBeNull();
    expect(validateWrite("deleteTournament", { tournamentId: "999" }, EMPTY_STATE)).toBeNull();
  });
});

describe("report pre-validation", () => {
  const sides = (a: string, b: string, outcomeA: Outcome = "win", outcomeB: Outcome = "loss") => [
    { participantId: a, outcome: outcomeA },
    { participantId: b, outcome: outcomeB },
  ];

  it("refuses reports on a draft tournament", () => {
    const state = stateWith(knowledgeOf({ status: "draft" }));
    expect(validateWrite("reportResult", { matchId: "21", sides: sides("11", "14") }, state)).toBe(
      "Cannot report a result: the tournament is draft",
    );
  });

  it("checks side count and finite scores before deriving", () => {
    const state = stateWith(knowledgeOf());
    expect(
      validateWrite("reportResult", { matchId: "21", sides: [sides("11", "14")[0]] }, state),
    ).toBe("A result must have exactly two sides");
    expect(
      validateWrite(
        "reportResult",
        {
          matchId: "21",
          sides: [
            { participantId: "11", outcome: "win", score: Number.NaN },
            { participantId: "14", outcome: "loss" },
          ],
        },
        state,
      ),
    ).toBe("A score must be a finite number");
  });

  it("accepts a valid report and refuses one for the wrong participants", () => {
    const state = stateWith(knowledgeOf());
    expect(
      validateWrite("reportResult", { matchId: "21", sides: sides("11", "14") }, state),
    ).toBeNull();
    // Carol is not in match 21: the candidate derives as voided.
    expect(validateWrite("reportResult", { matchId: "21", sides: sides("13", "14") }, state)).toBe(
      "This result does not apply to the match's current participants",
    );
  });

  it("surfaces the engine's own message for a derivation refusal", () => {
    const state = stateWith(knowledgeOf());
    expect(validateWrite("reportResult", { matchId: "21", sides: sides("11", "11") }, state)).toBe(
      "result 0 lists the same participant on both sides",
    );
    expect(
      validateWrite(
        "reportResult",
        { matchId: "21", sides: sides("11", "14", "draw", "draw") },
        state,
      ),
    ).toBe("result 0 is a draw, which this format does not allow");
  });
});

describe("write-result synthesis", () => {
  it("finds the created tournament among the new summaries", () => {
    const before = new Set(["3"]);
    const after = composeMyTournaments([
      {
        tournamentId: 3n,
        name: "Old",
        status: { tag: "Draft" },
        format: SINGLE,
        discipline: "Chess",
        shareSlug: "old",
      },
      {
        tournamentId: 8n,
        name: "New Cup",
        status: { tag: "Draft" },
        format: SINGLE,
        discipline: "Chess",
        shareSlug: "new-cup",
      },
    ]);
    expect(
      synthesizeCreated(before, after, {
        name: " New Cup ",
        discipline: " Chess ",
        format: { family: "single_elimination" },
      }),
    ).toEqual({ tournamentId: "8", shareSlug: "new-cup" });
    expect(
      synthesizeCreated(before, after, {
        name: "Other",
        discipline: "Chess",
        format: { family: "single_elimination" },
      }),
    ).toBeNull();
  });

  it("picks the newest when two matching tournaments appear in one window", () => {
    const row = (id: bigint, slug: string): MyTournamentRow => ({
      tournamentId: id,
      name: "Twin Cup",
      status: { tag: "Draft" },
      format: SINGLE,
      discipline: "Chess",
      shareSlug: slug,
    });
    const after = composeMyTournaments([row(8n, "twin-a"), row(9n, "twin-b")]);
    expect(
      synthesizeCreated(new Set(), after, {
        name: "Twin Cup",
        discipline: "Chess",
        format: { family: "single_elimination" },
      }),
    ).toEqual({ tournamentId: "9", shareSlug: "twin-b" });
  });

  it("finds the inserted seed run for a bulk add", () => {
    const after = [
      { participantId: "11", name: "Alice", seed: 1 },
      { participantId: "15", name: "Eve", seed: 2 },
      { participantId: "16", name: "Frank", seed: 3 },
    ];
    expect(synthesizeAddedParticipants(new Set(["11"]), after, ["Eve", "Frank"])).toEqual([
      "15",
      "16",
    ]);
  });

  it("answers empty, not foreign rows, while the matching run is missing", () => {
    const foreign = [{ participantId: "15", name: "Mallory", seed: 2 }];
    expect(synthesizeAddedParticipants(new Set(["11"]), foreign, ["Eve"])).toEqual([]);
  });

  it("diffs voided records for a report's return", () => {
    // All three matches decided, nothing voided: Alice and Bob won
    // their semifinals, Alice won the final.
    const before = composeOrganizerTournament({
      header: { ...HEADER, status: { tag: "Live" } },
      participants: ROSTER,
      matches: MATCHES,
      results: [
        resultRow(21n, 31n, 11n, 14n),
        resultRow(22n, 32n, 12n, 13n),
        resultRow(23n, 33n, 11n, 12n),
      ],
    }).knowledge!;
    expect(before.voidedResultIds.size).toBe(0);
    // A correction to the first semifinal (Dave now beats Alice)
    // supersedes record 31 — superseded records are not "voided" in
    // the engine's terms — and voids the final's record 33, which
    // named Alice as a finalist: that is this write's voided set.
    const after = composeOrganizerTournament({
      header: { ...HEADER, status: { tag: "Live" } },
      participants: ROSTER,
      matches: MATCHES,
      results: [
        resultRow(21n, 31n, 11n, 14n),
        resultRow(22n, 32n, 12n, 13n),
        resultRow(23n, 33n, 11n, 12n),
        resultRow(21n, 34n, 14n, 11n),
      ],
    }).knowledge!;
    const report = synthesizeReport(before, after);
    expect(report.status).toBe("live");
    expect(report.voided).toEqual([{ matchId: "23", matchKey: "W-R2-M1" }]);
  });
});
