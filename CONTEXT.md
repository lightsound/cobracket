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

**Registration requirement**:
A Track's setting saying who may be an Entrant — one ladder of three rungs: anonymous allowed (anonymous identities, and a captain may type a name with a claim link unless the Track is invite-only or hidden or its Event private) ⊃ account required (the default: every Entrant is an Account with a verified email, that is, Reachable; typed names only by the Organizer) ⊃ Squad-linked teams only (every Entry links a Squad). It applies to every Entrant of every Entry on the Track.
_Avoid_: Reachable-only, verified-only, open

**Entry**:
The unit that takes one place on a Track's registration list — a team, or on a one-player Track a single person: active (forming until it registers, then confirmed, waitlisted, or holding an Offer); cancelled, removed, or lapsed once it has ended (ended Entries are kept, visible to the Organizer only). The people on it are its Entrants. Made by its captain or a Squad's staff, or by the Organizer — on someone's behalf by name alone, or as one of the teams "make teams from the recruiting list" forms. When the Track runs a tournament, confirmed Entries flow into its draft Roster until the Organizer pins it, and after that only as changes the Organizer applies.
_Avoid_: Application, sign-up, registration (that is the act)

**Withdrawal**:
The state of a Participant whose Entry is no longer active — cancelled, removed, or lapsed — while the Participant is on a pinned Roster or in the last publication. The Participant stays in the bracket, its unplayed matches Walkovers by default (derived), until the Organizer substitutes, restores, or applies the change; an automatic publication drops withdrawn Participants it does not refill. An Entry that never reached a Roster simply ends.
_Avoid_: Drop, dropout, forfeit (a forfeit is a Walkover, recorded on a match)

**Capacity**:
The number of confirmed Entries a Track accepts. Unset means unlimited. A confirmed Entry keeps its place until it is cancelled or removed — nothing else takes it away, which is why Capacity cannot be lowered below the places already given out.
_Avoid_: Limit, slots

**Waitlist**:
The ordered queue of Entries waiting for a Track's Capacity to free up. Its unit is the Entry; only an Entry whose captain is Reachable, or whose Squad link is live, joins it.
_Avoid_: Queue, standby, reserve list

**Offer**:
A freed place held for a limited time for the next waitlisted Entry that chose to be asked first (by default a freed place confirms the next Entry at once), taken by the Entry's captain or by a Squad's staff; accepting it confirms the Entry, and declining it or letting it expire ends the Entry as lapsed; if the Track stops accepting registrations first, it returns to the Waitlist with the Entry's place kept.
_Avoid_: Promotion (ADR 0015's prose word for a waitlisted Entry taking a freed place, which is a confirmation at once or an Offer; in the team rules, making an ad-hoc team a Squad), invitation (an invite link is an Access Grant, the Organizer's register link or a team's join link, and a team invitation is an `invited` Entrant row that a captain or the staff sends)

**Publish**:
Making an Event, or a tournament's bracket, visible to others; unpublishing takes it back while nothing depends on it yet. A tournament keeps a record of its last publication, against which Registrants' status is read; while it is being revised, players and Spectators see by default only that it is being updated, or — the Organizer's choice — that publication under a banner; publishing a Track's tournament closes that Track's public registration. A published tournament's structure is fixed; a tournament inside an Event can be published only while its Event is (one published before a cancellation may be republished after it). Distinct from Visibility (who may open what is published) and from a Track being open for registration.
_Avoid_: Launch, release, go live (a tournament goes live on its first result)

**Access Grant**:
A secret link or code that lets its holder perform one action — register, claim a typed-name Entrant of an Entry, join a Community, join a Squad, take over an Event, move a Community under another, or record results on one tournament. A Track- or Event-scope register Grant works within its own time window and use limit, past its Track's invite-only or hidden setting (an Event-wide one passes invite-only Tracks only), and into a full Track only if it reserves its seats (a single-Track Grant with a use limit may, holding one seat per remaining use); one scoped to a single Entry is a team's join link, admitting Entrants onto that Entry through the activation function — it has no window of its own (it ends with the Entry, the swap deadline, or a change that makes its Track invite-only or hidden or its Event private), admits while the Entry's playing Entrants and its own uses (the rows it admitted that are still active or were removed) are below the maximum, and passes no Track setting. "Invite link" is its everyday name in the UI.
_Avoid_: Token, password, coupon, unlock code

**Visibility**:
Who may open something that is published: unlisted (anyone holding its link, the default) or private (only its Organizer, people with an active Entry in it, people invited onto an Entry in it, the staff of a Squad-linked Entry in it while that Entry's Squad link is live, holders of an Access Grant they can still act on, and — for their own bracket only, unless a Track-scope Sanction ended their view — withdrawn Participants and Entrants who left or were removed). It only narrows from Event to Track to tournament; a hidden Track is private within its Event. A Community page has a Visibility too (ADR 0028): private there means its members only. Public — findable without a link — is reserved for when cobracket has a directory.
_Avoid_: Privacy, access level, audience

**Check-in**:
On-site confirmation that an entered participant is actually present (QR scan or manual). Absence after check-in closes becomes a Walkover.
_Avoid_: Attendance, arrival

### People

**Organizer**:
A member of the Community that owns a tournament or Event — or an owner or admin of one of that Community's ancestors (ADR 0028) — operating it end to end: managing participants, entering results, advancing the tournament. Always an Account. The role of a member — owner, admin, organizer, or staff (defined, not yet built) — says which capabilities they hold; "owner" names the one member who manages the Community itself, not an Organizer, and "admin" the members who govern it beside the owner.
_Avoid_: Admin as a word for an Organizer (it is a member's role), host, co-organizer (an Organizer is one already)

**Community**:
The named group that owns Events, tournaments, bans, and participant codes, can publish its own Rankings, and may carry Squads of players; every Organizer acts as a member of one, and a Community with a Squad is what everyone calls a team. Each Account gets a first Community, named after the person, that is in no way special. It has exactly one owner, who manages members and the Community itself, any number of admins, who govern it beside the owner, and any number of organizers; people join through an Access Grant, an Event is handed to another Community through one, and a Community is deleted by its owner — a child also by the parent's owner or admin — while nothing published is pending and it has no child Communities. Communities nest under exactly one parent, three deep: the parent's owner and admin govern the children and the parent's bans apply to them.
_Avoid_: Organization, guild, group, club (all of these are Communities)

**Reachable**:
Said of a user cobracket can actually send a message to, through at least one verified channel such as a confirmed email address. Being signed in is not enough. Waiting states (the Waitlist) and account-required Tracks require it.
_Avoid_: Verified, registered, logged in

**Registrant**:
A person with an active Entrant row on an Entry of a Track (or an ended one, for the withdrawn view) — the one who registered, joined a team, or claimed a typed name; an invitation or request not yet accepted makes nobody a Registrant. A Participant's Event-side counterpart, before any tournament exists, is the Entry, and a Registrant is one of that Entry's people (on a one-player Track, its one person); an Entrant entered by name and never claimed has no Registrant behind it. Being a Registrant is a relation to a Track, not a kind of user: the same person can organize one Event and register for another.
_Avoid_: Applicant, attendee, member (that is a Community's)

**Participant**:
A person or team competing in one tournament — a tournament-local record standing for one Entry on a Track's tournament (a standalone tournament's Participants stand for no Entry); once the tournament first completes, it keeps the Players credited with its placement (the Lineup of at least one of its matches; the one Player on a one-player Track).
_Avoid_: Player (that means the cross-tournament identity), competitor

**Roster**:
A tournament's Participants taken as a whole. For a Track's tournament it follows the confirmed Entries until the Organizer pins it; afterwards the difference is shown as pending changes the Organizer applies — membership only while the tournament is a draft (a confirmed Entry taken off the Roster stays as an alternate), and substitutions or restorations for withdrawn Participants even during play — except that an automatic publication applies the pending changes as of its time itself. Names are labels, not pending changes: a rename reaches the Participant at once.
_Avoid_: Participant list, entrant list, squad (a Squad is a team's standing list of players; a Lineup is who played)

**Player**:
The persistent identity of a competitor across tournaments: a record holding no contact data (it still links one person's records, so it is personal data in law), created at a person's first Entry or Squad membership and kept after their account is deleted. Self-made Entrants link to a Player automatically; typed-name Entrants are claimed by their Player later. Merging two identities keeps both rows, one as an alias, so no stored standing loses its key. Rankings attach to Players or to chains of Entries, never to Participants.
_Avoid_: User, member

**Spectator**:
Anyone following a tournament without competing in or operating it.
_Avoid_: Viewer, audience

**Account**:
A user who has verified an email address by signing in with a one-time code, and so is Reachable. A Registrant may start as an anonymous identity tied to one browser; verifying an email upgrades it in place, or merges its Entrant rows into the account that already holds that email. Everything on the Organizer side, joining a Waitlist, registering on an account-required Track, and using MCP need one. Deleting it removes the person's data and keeps the records they appear in.
_Avoid_: Profile, login, registered user

**Share Link**:
A tournament's unlisted URL granting view-only, real-time access to its bracket with no account required, wherever the tournament's Visibility is unlisted or public. How participants and spectators follow a tournament.
_Avoid_: Public link, invite link

**Report**:
A signed-in account's notice to the operator that something on cobracket is abusive — phishing, harassment, or other. It only queues the item for the operator: nothing happens automatically, except that a reported Community logo is hidden while the report is under review (ADR 0028), and the reported side is never told of it.
_Avoid_: Flag, complaint

**Suspension**:
The operator's sanction on an account, a Community, or an Event. A suspended Event stops everything that reaches other people and is kept intact; a suspended person can only sign in to see why, reach the operator, read their own data, or delete the account. Distinct from a Sanction, which an Organizer or a Community sets.
_Avoid_: Ban, block (both are Sanctions), takedown

**Sanction**:
One row that replaces the Organizer's block and the Community's ban. Its scope is a Track or a Community — a Community-scope Sanction is a ban and reads along the tree, binding the Community's descendants — and its target a person or a Community. A person-target row is set from an Entrant row (or, from the ban preview, from a Squad member with none) — by the Organizer on a Track, by the banning Community's owner or admin at Community scope — and carries the person and, when one exists, that source Entrant; a Community-target row (a ban on a team, Community scope only) is set by the banning Community's owner or admin from the ban preview or the Community page and carries neither. Lifted by whoever may set it, which ends the row and reinstates nothing. A person-target row is stored per person and never shown to anyone else; a dormant row keeps the person's participant code.
_Avoid_: Block, blacklist

### Teams

**Team**:
The everyday word for a Community that carries a Squad, and, in a tournament, for an Entry on any Track but a one-player one, however many playing Entrants it has at the moment. Not a kind of record: a persistent team is a Community, a team in a bracket is an Entry. Such an Entry without a Squad link is an _ad-hoc_ team, acting through its captain — the one playing Entrant carrying the captain flag; a Squad-linked Entry acts through the Squad's staff while its link is live.
_Avoid_: Crew, clan, roster (as the team itself)

**Squad**:
A standing list of Players a Community keeps for competition — several per Community if it fields more than one unit. Its players are called Squad members; a Community's people are members. Joining one needs an Account and is standing consent to be entered in tournaments by the Community's staff; it confers no permission; each Squad member may carry one display label (coach, sub, …). "Staff" means the Community's members acting for its Squads and Squad-linked Entries, whatever their role: every member (owner, admin, organizer, staff) may operate a Squad-linked Entry — register it, set its lineup, accept or decline an Offer, cancel it — while creating or deleting a Squad and editing its players and labels take the owner, admin, or organizer, and removing a player from a descendant's Squad takes the ancestor's owner or admin. Named by the Community's name, plus its own where the Community has several.
_Avoid_: Roster (that is a tournament's Participants), lineup, team (a Squad is a team's standing list of players, not the team)

**Entrant**:
A person on an Entry: invited or requested before consenting, active while on the team, then declined, left, or removed. Carries whether they play (a coach does not) and, on an ad-hoc team, whether they are its captain — the one playing Entrant who acts for the team; a Squad's Entry has no captain while its Squad link is live, its staff act for it. On a one-player Track the Entry's single Entrant.
_Avoid_: Member (in the UI that is the Japanese word for it, but in English a member is a Community's), player (that is the cross-tournament identity)

**Lineup**:
The playing Entrants of an Entry at an instant: a match's Lineup is who was active and playing when its result was recorded, and a team's placement is credited to everyone on the Lineup of at least one of its matches. Part of the published result of a completed tournament. What Rankings compare to tell whether two Entries are the same team.
_Avoid_: Roster, squad, starters, substitution (that re-points a withdrawn Participant to another Entry; changing who plays is a swap or the Organizer's lineup change)

**Affiliation**:
A mutual, permission-free link between two Communities shown on both pages — a team in a league, a club in a federation. Shares no bans, codes, or visibility; what should share them is a parent, not an affiliate.
_Avoid_: Partnership, membership (that is a person's), parent

### Communication

**Activity**:
A recorded occurrence — who did what to which subjects, and who may see it. The single record that notifications, audit history, feeds, and external integrations are all derived from.
_Avoid_: Event (that is the gathering), log entry, notification

**Announcement**:
A message an Organizer posts to an Event's audience; its own document, editable and deletable, referenced by an Activity and delivered to whichever destinations the Organizer and each recipient choose.
_Avoid_: Post, broadcast, news

**Follow**:
A person's standing interest in a subject so its Activities reach them. Registrants and Organizers follow what they take part in implicitly; an Account follows a Community explicitly — its Entries confirmed on public Events, placements in public tournaments, Squad changes, and moves in public Rankings reach them, in the app and by email if they ask — and explicit Follows of Events, Tracks, and Players come later.
_Avoid_: Subscription (the mechanism, not the domain term), watch

### Rankings

**Ranking**:
A Community's published reading of public tournament results: a standing of Players, or of teams, in one Discipline under one Method, over the tournaments its publisher chose, computed Season by Season. A team Ranking stands chains of Entries, linked tournament to tournament by the same Squad or by enough shared players, as the publisher chooses. Any Community publishes one (a person through their own first Community; cobracket official is the operator's Community), counting any non-private tournament it can view without the Organizer's consent, and never more visible than the narrowest tournament it counts.
_Avoid_: Leaderboard, standings (that means placements within one tournament), power ranking

**Method**:
One of three fixed ways a Ranking turns results into standings — placement points (with named settings such as tiers, entrants multiplier, field strength, head-to-head, best-N), a rating updated per match, or a manual order over the Players (or, in a team Ranking, the chains of Entries) in the counted tournaments. Settings are named knobs with defaults, never a formula.
_Avoid_: Algorithm, formula

**Season**:
One window of a Ranking, cut by its publisher — fixed dates or a rolling length, with the timezone of its boundaries — carrying its own scope of counted tournaments and Method settings, so a change for one Season never moves another. A rolling window is a Season with no end.
_Avoid_: Period, cycle, edition

**Revision**:
One stored computation of a Season's standings, with its instant, the tournaments it counted, and the difference from the previous one and its cause. A Season has no frozen final: its last Revision at the window's end is its final standings, and a later correction adds a newer one beside it.
_Avoid_: Snapshot, version, edition

**Intervention**:
A hand of a Ranking's publisher that changes what a Revision would otherwise compute — a tournament added or excluded by hand, a tier assigned, a point adjustment or an exclusion (on a team or on a Player, across every team they are on), a typed name linked to a Player, an Entry declared a new team or the same team as an earlier one, a manual reorder — always listed on the Ranking with a reason from a fixed set.
_Avoid_: Override, correction (that is a result's)
