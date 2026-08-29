# cobracket

cobracket lets anyone easily host and manage a tournament of any format. It aims to replace existing tournament tools — slow, dated, confusing — with a fast modern UI and chat-based operation through AI (an MCP server first), and to grow into a monetizable service. The first audience is game and esports community tournaments.

## Language

**Tournament**:
A competitive event in which participants play matches under a chosen format until a result is decided. Not limited to single elimination.
_Avoid_: Event, competition

**Format**:
The rule set that determines how a tournament's matches are generated and how it progresses (e.g. single elimination, double elimination, round robin, Swiss, group stage into playoffs).
_Avoid_: Mode, type

**Bracket**:
The visual representation of a tournament's match structure produced by its format. Used in the broad sense: elimination trees, round-robin result tables, and standings are all brackets.
_Avoid_: Tournament table, tree, ladder

**Match**:
A single contest between two participants inside a tournament; the unit a bracket is made of. Its result is a winner plus an optional score.
_Avoid_: Game, round (a round is a set of matches)

**Seeding**:
The deliberate initial placement of participants in a bracket.
_Avoid_: Ranking, ordering

**Organizer**:
The person who creates a tournament and operates it end to end: managing participants, entering results, advancing the tournament.
_Avoid_: Admin, host, owner

**Participant**:
A person or team competing in a tournament.
_Avoid_: Player, entrant, competitor

**Spectator**:
Anyone following a tournament without competing in or operating it.
_Avoid_: Viewer, audience

**Share Link**:
A tournament's public URL granting view-only, real-time access to its bracket with no account required. How participants and spectators follow a tournament.
_Avoid_: Public link, invite link
