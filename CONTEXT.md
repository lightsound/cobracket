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
A match resolved without play because one side is absent or withdrew; the present side advances. No-shows are recorded as Walkovers; the published bracket is never regenerated for them. A withdrawn Participant's unplayed matches are Walkovers by default, derived until a result depending on one is recorded.
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
A registration unit within an Event that participants enter: one game's competition, or the pro and amateur splits of the same game. Open to anyone who can see the Event, invite-only, or hidden. A Track may later run a tournament, and may declare other Tracks it cannot be combined with.
_Avoid_: Division, slot, sub-event

**Entry**:
One place on a Track's registration list: confirmed, waitlisted, or holding an Offer while active; cancelled, removed, or lapsed once it has ended (ended Entries are kept, visible to the Organizer only). Made by a Registrant for themselves, or by the Organizer on someone's behalf by name alone. When the Track runs a tournament, confirmed Entries flow into its draft Roster until the Organizer pins it, and after that only as changes the Organizer applies.
_Avoid_: Application, sign-up

**Withdrawal**:
The state of a Participant whose Entry is no longer active — cancelled, removed, or lapsed — while the Participant is on a pinned Roster or in the last publication. The Participant stays in the bracket, its unplayed matches Walkovers by default (derived), until the Organizer substitutes, restores, or applies the change; an automatic publication drops withdrawn Participants it does not refill. An Entry that never reached a Roster simply ends.
_Avoid_: Drop, dropout, forfeit (a forfeit is a Walkover, recorded on a match)

**Capacity**:
The number of confirmed Entries a Track accepts. Unset means unlimited. A confirmed Entry keeps its place until it is cancelled or removed — nothing else takes it away, which is why Capacity cannot be lowered below the places already given out.
_Avoid_: Limit, slots

**Waitlist**:
The ordered queue of Entries waiting for a Track's Capacity to free up. Only Registrants the platform can reach may join it.
_Avoid_: Queue, standby, reserve list

**Offer**:
A freed place held for a limited time for the next waitlisted Registrant who chose to be asked first (by default a freed place confirms the next person at once); accepting it confirms the Entry, and declining it or letting it expire ends the Entry as lapsed; if the Track stops accepting registrations first, it returns to the Waitlist with the person's place kept.
_Avoid_: Promotion, invitation (that is a separate, Organizer-initiated mechanism)

**Publish**:
Making an Event, or a tournament's bracket, visible to others; unpublishing takes it back while nothing depends on it yet. A tournament keeps a record of its last publication, against which Registrants' status is read; while it is being revised, players and Spectators see by default only that it is being updated, or — the Organizer's choice — that publication under a banner; publishing a Track's tournament closes that Track's public registration. A published tournament's structure is fixed; a tournament inside an Event can be published only while its Event is (one published before a cancellation may be republished after it). Distinct from Visibility (who may open what is published) and from a Track being open for registration.
_Avoid_: Launch, release, go live (a tournament goes live on its first result)

**Access Grant**:
A secret link or code that lets its holder perform one action — register, claim an Entry, join a Community, take over an Event, or record results on one tournament. A register Grant works within its own time window and use limit, past its Track's invite-only or hidden setting (an Event-wide one passes invite-only Tracks only), and into a full Track only if it reserves its seats (a single-Track Grant with a use limit may, holding one seat per remaining use). "Invite link" is its everyday name in the UI.
_Avoid_: Token, password, coupon, unlock code

**Visibility**:
Who may open something that is published: unlisted (anyone holding its link, the default) or private (only its Organizer, people with an active Entry in it, holders of an Access Grant they can still act on, and — for their own bracket only — withdrawn Participants). It only narrows from Event to Track to tournament; a hidden Track is private within its Event. Public — findable without a link — is reserved for when cobracket has a directory.
_Avoid_: Privacy, access level, audience

**Check-in**:
On-site confirmation that an entered participant is actually present (QR scan or manual). Absence after check-in closes becomes a Walkover.
_Avoid_: Attendance, arrival

### People

**Organizer**:
A member of the Community that owns a tournament or Event, operating it end to end: managing participants, entering results, advancing the tournament. Always an Account. The role of a member — owner or organizer — says which capabilities they hold; "owner" names the one member who manages the Community itself, not an Organizer.
_Avoid_: Admin, host, co-organizer (an Organizer is one already)

**Community**:
The named group that owns Events, tournaments, bans, and participant numbers, and can publish its own Rankings; every Organizer acts as a member of one. Each Account gets a first Community, named after the person, that is in no way special. It has exactly one owner, who manages members and the Community itself, and any number of organizers; people join through an Access Grant, an Event is handed to another Community through one, and a Community is deleted by its owner while nothing published is pending.
_Avoid_: Organization, guild, group, team (a competing team is not a Community)

**Reachable**:
Said of a user cobracket can actually send a message to, through at least one verified channel such as a confirmed email address. Being signed in is not enough. Waiting states (the Waitlist) and reachable-only Tracks require it.
_Avoid_: Verified, registered, logged in

**Registrant**:
The person an Entry belongs to — its holder: whoever made it for themselves, or later claimed one the Organizer entered for them. The Event-side counterpart of a Participant, before any tournament exists; an Entry entered by name and never claimed has no Registrant. Being a Registrant is a relation to a Track, not a kind of user: the same person can organize one Event and register for another.
_Avoid_: Entrant, applicant, attendee

**Participant**:
A person or team competing in one tournament — a tournament-local record, which may or may not be linked to a Player.
_Avoid_: Player (that means the cross-tournament identity), entrant, competitor

**Roster**:
A tournament's Participants taken as a whole. For a Track's tournament it follows the confirmed Entries until the Organizer pins it; afterwards the difference is shown as pending changes the Organizer applies — membership only while the tournament is a draft (a confirmed Entry taken off the Roster stays as an alternate), and substitutions or restorations for withdrawn Participants even during play — except that an automatic publication applies the pending changes as of its time itself. Names are labels, not pending changes: a rename reaches the Participant at once.
_Avoid_: Participant list, lineup, entrant list

**Player**:
The persistent identity of a competitor across tournaments: a record holding no contact data (it still links one person's records, so it is personal data in law), created at a person's first Entry and kept after their account is deleted. Self-made Entries link to a Player automatically; organizer-entered Participants can be claimed by their Player later. Rankings attach to Players, not Participants.
_Avoid_: User, member

**Spectator**:
Anyone following a tournament without competing in or operating it.
_Avoid_: Viewer, audience

**Account**:
A user who has verified an email address by signing in with a one-time code, and so is Reachable. A Registrant may start as an anonymous identity tied to one browser; verifying an email upgrades it in place, or merges its Entries into the account that already holds that email. Everything on the Organizer side, joining a Waitlist, registering on a reachable-only Track, and using MCP need one. Deleting it removes the person's data and keeps the records they appear in.
_Avoid_: Profile, login, registered user

**Share Link**:
A tournament's unlisted URL granting view-only, real-time access to its bracket with no account required, wherever the tournament's Visibility is unlisted or public. How participants and spectators follow a tournament.
_Avoid_: Public link, invite link

**Report**:
A signed-in account's notice to the operator that something on cobracket is abusive — phishing, harassment, or other. It only queues the item for the operator; nothing happens automatically, and the reported side never learns of it.
_Avoid_: Flag, complaint

**Suspension**:
The operator's sanction on an account or an Event. A suspended Event stops everything that reaches other people and is kept intact; a suspended person can only sign in to see why, reach the operator, read their own data, or delete the account. Distinct from a Community's ban and an Organizer's block.
_Avoid_: Ban (a Community's), block (a Track's), takedown

### Communication

**Activity**:
A recorded occurrence — who did what to which subjects, and who may see it. The single record that notifications, audit history, feeds, and external integrations are all derived from.
_Avoid_: Event (that is the gathering), log entry, notification

**Announcement**:
A message an Organizer posts to an Event's audience; its own document, editable and deletable, referenced by an Activity and delivered to whichever destinations the Organizer and each recipient choose.
_Avoid_: Post, broadcast, news

**Follow**:
A person's standing interest in a subject — an Event, a Track, or a Player — so its Activities reach them. Registrants and Organizers follow what they take part in implicitly; explicit Follows come later.
_Avoid_: Subscription (the mechanism, not the domain term), watch

### Rankings

**Ranking**:
A Community's published reading of public tournament results: a standing of Players in one Discipline under one Method, over the tournaments its publisher chose, computed Season by Season. Any Community publishes one (a person through their own first Community; cobracket official is the operator's Community), counting any non-private tournament it can view without the Organizer's consent, and never more visible than the narrowest tournament it counts.
_Avoid_: Leaderboard, standings (that means placements within one tournament), power ranking

**Method**:
One of three fixed ways a Ranking turns results into standings — placement points (with named settings such as tiers, entrants multiplier, field strength, head-to-head, best-N), a rating updated per match, or a manual order over the Players in the counted tournaments. Settings are named knobs with defaults, never a formula.
_Avoid_: Algorithm, formula

**Season**:
One window of a Ranking, cut by its publisher — fixed dates or a rolling length, with the timezone of its boundaries — carrying its own scope of counted tournaments and Method settings, so a change for one Season never moves another. A rolling window is a Season with no end.
_Avoid_: Period, cycle, edition

**Revision**:
One stored computation of a Season's standings, with its instant, the tournaments it counted, and the difference from the previous one and its cause. A Season has no frozen final: its last Revision at the window's end is its final standings, and a later correction adds a newer one beside it.
_Avoid_: Snapshot, version, edition

**Intervention**:
A hand of a Ranking's publisher that changes what a Revision would otherwise compute — a tournament added or excluded by hand, a tier assigned, a point adjustment, a typed name linked to a Player, a manual reorder — always listed on the Ranking with a reason from a fixed set.
_Avoid_: Override, correction (that is a result's)
