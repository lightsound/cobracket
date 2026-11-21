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
} from "./spacetimedb-model";

// The adapter's pure layer, pinned: compositions turn binding rows
// into the seam's contract shapes, and the write-result syntheses
// read the returns reducers do not have from before/after
// compositions. (Write refusals are not pinned here: they are the
// module's SenderError texts, pinned by the module harness suite
// and the connection suite's wire proof.) Fixtures are binding rows
// as the generated types define them.

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
    expect(knowledge!.resultCount).toBe(0);
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

describe("write-result synthesis", () => {
  it("parses bulk names the roster reducer's way", () => {
    expect(parseBulkNames(" A \n\nB\r\n C ")).toEqual(["A", "B", "C"]);
    expect(parseBulkNames(" \n ")).toEqual([]);
    expect(parseBulkNames("A\rB\rC")).toEqual(["A", "B", "C"]);
    expect(parseBulkNames("A\u2028B\u2028C")).toEqual(["A", "B", "C"]);
    expect(parseBulkNames("A\u2029B\u2029C")).toEqual(["A", "B", "C"]);
    expect(parseBulkNames("A\nB\r\nC\rD\u2028E\u2029F")).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

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
