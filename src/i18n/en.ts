// English is the source dictionary: its keys define MessageKey, and every
// other locale must cover exactly these keys (story 24).
export const en = {
  "app.title": "cobracket",
  "app.loading": "Loading…",
  "app.retry": "Retry",
  "app.notFound": "Page not found.",
  "app.backHome": "Back to home",
  "app.setupConvex": "Set VITE_CONVEX_URL in .env.local and run `bun run convex:dev`.",

  "theme.label": "Theme",
  "theme.system": "Auto",
  "theme.light": "Light",
  "theme.dark": "Dark",

  "locale.label": "Language",

  "format.single_elimination": "Single elimination",
  "format.double_elimination": "Double elimination",

  "status.draft": "Draft",
  "status.published": "Published",
  "status.live": "Live",
  "status.completed": "Completed",

  "home.heading": "Your tournaments",
  "home.empty": "No tournaments yet — create one below.",
  "home.signedOut": "Create your first tournament below — no sign-up needed.",
  "home.checkingSession": "Checking your session…",
  "home.create.heading": "New tournament",
  "home.create.name": "Tournament name",
  "home.create.namePlaceholder": "Friday Night Bracket",
  "home.create.discipline": "Discipline",
  "home.create.disciplinePlaceholder": "e.g. Street Fighter 6",
  "home.create.format": "Format",
  "home.create.submit": "Create tournament",

  "tournament.share.copy": "Copy Share Link",
  "tournament.share.copied": "Copied!",
  "tournament.share.hint": "Anyone with this link can watch the bracket live — no account needed.",

  "roster.heading": "Participants",
  "roster.count": "{count} participants",
  "roster.empty": "No participants yet — add them below.",
  "roster.addPlaceholder": "Participant name",
  "roster.add": "Add",
  "roster.bulkPlaceholder": "Paste a list of names — one per line",
  "roster.bulkAdd": "Add all",
  "roster.rename": "Rename",
  "roster.remove": "Remove",
  "roster.save": "Save",
  "roster.cancel": "Cancel",
  "roster.moveUp": "Move up",
  "roster.moveDown": "Move down",
  "roster.locked": "The roster is locked: the tournament is {status}.",

  "seeding.random": "Seeding: random — reshuffled on every generation.",
  "seeding.manual": "Seeding: manual order.",

  "bracket.heading": "Bracket",
  "bracket.generate": "Generate Bracket",
  "bracket.regenerate": "Regenerate Bracket",
  "bracket.none": "Generate the bracket to preview it here.",
  "bracket.needTwo": "Add at least two participants to generate a bracket.",
  "bracket.stale": "The roster changed, so the bracket was discarded — regenerate it.",
  "bracket.publish": "Publish",
  "bracket.publishHint": "Publishing makes the bracket visible on the Share Link.",
  "bracket.section.winners": "Winners",
  "bracket.section.losers": "Losers",
  "bracket.section.grand_final": "Grand Final",
  "bracket.bye": "Bye",
  "bracket.tbd": "TBD",
  "bracket.ready": "Up next",
  "bracket.voided": "Needs re-entry",
  "bracket.zoomIn": "Zoom in",
  "bracket.zoomOut": "Zoom out",
  "bracket.zoomReset": "Reset view",

  "outcome.walkover": "Walkover",
  "outcome.disqualification": "DQ",

  "report.record": "Record result",
  "report.correct": "Correct result",
  "report.winner": "Winner",
  "report.how": "Decided by",
  "report.how.played": "Played match",
  "report.how.walkover": "Walkover (no-show)",
  "report.how.disqualification": "Disqualification",
  "report.score": "Score (optional)",
  "report.submit": "Save result",
  "report.cancel": "Cancel",
  "report.pickWinner": "Pick the winner first.",
  "report.voided":
    "This correction voided {count} downstream result(s) — re-enter them on the highlighted matches.",

  "champion.heading": "Champion",
  "standings.heading": "Standings",
  "standings.placement": "Place",
  "standings.participant": "Participant",

  "share.notFound":
    "This tournament is not available. The link may be wrong, or the bracket is not published yet.",
  "share.bracketPending": "The bracket is being reworked — check back in a moment.",
};

export type MessageKey = keyof typeof en;
