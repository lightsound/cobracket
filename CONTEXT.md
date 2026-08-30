# cobracket

cobracket lets anyone easily host and manage a tournament of any format. It aims to replace existing tournament tools — slow, dated, confusing — with a fast modern UI and chat-based operation through AI (an MCP server first), and to grow into a monetizable service. The first audience is game and esports community tournaments.

## Language

### Competition structure

**Tournament**:
A competitive event in which participants play matches under a chosen format until a result is decided. Not limited to single elimination. Can exist standalone or attached to a Track.
_Avoid_: Competition

**Format**:
The rule set that determines how a tournament's matches are generated and how it progresses (e.g. single elimination, double elimination, round robin, Swiss, group stage into playoffs).
_Avoid_: Mode, type

**Bracket**:
The visual representation of a tournament's match structure produced by its format. Used in the broad sense: elimination trees, round-robin result tables, and standings are all brackets.
_Avoid_: Tournament table, tree, ladder

**Match**:
A single contest between two participants inside a tournament; the unit a bracket is made of. Its result is an outcome — win, loss, draw, walkover, or disqualification — plus an optional score.
_Avoid_: Game, round (a round is a set of matches)

**Walkover**:
A match resolved without play because one side is absent or withdrew; the present side advances. How no-shows are recorded — the published bracket is never regenerated for them.
_Avoid_: Forfeit, default win

**Standings**:
The placement of participants within a single tournament, derived from its recorded results. Distinct from a Ranking, which aggregates across tournaments.
_Avoid_: Placements, final results

**Seeding**:
The deliberate initial placement of participants in a bracket.
_Avoid_: Ranking, ordering

**Discipline**:
The competitive game or sport a track or tournament belongs to (e.g. Street Fighter 6, table tennis). The axis along which seeding and rankings aggregate.
_Avoid_: Game, category, genre, title, sport

### Events and registration

**Event**:
A scheduled gathering, luma-style, with its own page and participant registration. An Event may run zero or more tournaments; hosting a plain Event with no competition is valid.
_Avoid_: Meetup, gathering. (Beware: start.gg inverts this vocabulary — its "tournament" is the container and its "event" is the competition. In cobracket the Event is always the container.)

**Track**:
A registration unit within an Event that participants enter: one game's competition, or the pro and amateur splits of the same game. A Track may later run a tournament, and may declare other Tracks it cannot be combined with.
_Avoid_: Division, slot, sub-event

**Entry**:
A participant's application to a Track.
_Avoid_: Application, sign-up

**Check-in**:
On-site confirmation that an entered participant is actually present (QR scan or manual). Absence after check-in closes becomes a Walkover.
_Avoid_: Attendance, arrival

### People

**Organizer**:
The person who creates a tournament or event and operates it end to end: managing participants, entering results, advancing the tournament.
_Avoid_: Admin, host, owner

**Community**:
A named group of organizers that owns Events and can publish its own Rankings.
_Avoid_: Organization, guild, group

**Participant**:
A person or team competing in one tournament — a tournament-local record, which may or may not be linked to a Player.
_Avoid_: Player (that means the cross-tournament identity), entrant, competitor

**Player**:
The persistent, account-backed identity of a competitor across tournaments. Self-made Entries link to a Player automatically; organizer-entered Participants can be claimed by their Player later. Rankings attach to Players, not Participants.
_Avoid_: User, member

**Spectator**:
Anyone following a tournament without competing in or operating it.
_Avoid_: Viewer, audience

**Share Link**:
A tournament's public URL granting view-only, real-time access to its bracket with no account required. How participants and spectators follow a tournament.
_Avoid_: Public link, invite link

### Rankings

**Ranking**:
A published standing of Players in a Discipline. Identified by its publisher (cobracket official or a Community), its Method, its aggregation window (a Season or a rolling period), and the scope of results it counts. One publisher can publish several Rankings for the same Discipline, one per Method.
_Avoid_: Leaderboard, standings (that means placements within one tournament)

**Method**:
The measurement methodology a Ranking uses to turn tournament results into standings (e.g. placement-point tables weighted by tournament size, rating systems).
_Avoid_: Algorithm, formula

**Season**:
A publisher-defined time window whose tournament results aggregate into one edition of a Ranking. Each publisher cuts its own windows — official and community seasons over the same Discipline can differ freely.
_Avoid_: Period, cycle
