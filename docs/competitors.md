# Competitors

The tools cobracket is compared against, as of **2026-10-18** — one research pass over official pages, help centers, press, registries, and community write-ups, sources inline. It describes other products; what cobracket itself has built, specified, or only planned lives in [`docs/vision.md`](./vision.md) and [`docs/specs/`](./specs/). Prices, owners, launches, and shutdowns move, so each fact that moves carries its date, and the last section lists what to re-check before relying on this document again.

## Summary

Seven groups: global esports tournament platforms, Japanese tournament services, ranking tools and results hubs, chat- and AI-operated newcomers, event-registration tools and the spreadsheet-plus-Discord stack, trading-card-game and chess organized play, and physical-sports league tools.

- Closest to the whole roadmap: **Tonamel** (Japan) and **start.gg** (global). Both already run most of the vision's loop — registration, brackets, organizer groups; start.gg adds leagues, rankings, and ranking-fed seeding.
- Closest to what cobracket has live (an account-free realtime bracket): **OFTN.GG**, **parry.gg**, **Whistle.day**. That part alone no longer differentiates.
- Chat operation: **Whistle.day**, **Turnale**, and **Turniermeister** ship write-capable MCP servers (seen September–October 2026; Turnale undated), and the self-hosted **Wizzrobe** has one (below; undated). No major platform does.
- Not found anywhere: Rankings that anyone may publish over other Organizers' public results, with every recalculation kept as a public Revision carrying a diff and a reason. Braacket's history features could not be verified (its site refuses automated reads).
- Free hosting of free-entry tournaments is the industry floor (start.gg, Challonge, Tonamel, OFTN.GG up to 32 players, Whistle.day), not a lever.

## Global tournament platforms

### start.gg

- Acquired by Microsoft 2020-12-02 as smash.gg, renamed 2022-05-16, independent again since 2025-01-31 ([PlayDay.One](https://playday.one/2025/01/31/event-platform-start-gg-becomes-independent-reiterates-focus-on-grassroot-and-professional-esport-community-support/), [SmashWiki](https://www.ssbwiki.com/Start.gg)).
- Since 2025-02-14 a 6% platform fee on online paid registrations, charged to the participant on top; free events pay nothing ([help](https://help.start.gg/en/articles/13768814-what-are-the-platform-fee-and-processing-fee), [Dashfight](https://dashfight.com/news/start-gg-splits-away-from-microsoft-introduces-new-registration-fees-6993)).
- Structure: a _tournament_ contains _events_ (one per game or bracket), which contain phases — the inverse of cobracket's vocabulary, where the Event is the container ([Event Creation](https://help.start.gg/en/articles/13766241-event-creation)).
- Has hubs, leagues with per-tier placement points and public reasoned point adjustments (starting a league needs start.gg support's approval), user-submitted rankings, a seed generator that reads those rankings, online check-in, self-reported results, a native iOS/Android app (August 2026), and a web UI in 15 locales including Japanese ([Hub Pages](https://help.start.gg/en/articles/13764583-hub-pages), [Leagues & Circuits](https://help.start.gg/en/articles/13766319-leagues-circuits-on-start-gg), [Submit a Ranking](https://help.start.gg/en/articles/13764515-how-do-i-submit-a-ranking), [Seed Generator](https://help.start.gg/en/articles/13768804-using-the-seed-generator), [Reporting](https://help.start.gg/en/articles/13766247-reporting-match-results), [app](https://www.start.gg/app)).
- Account-first: participants an organizer adds without an account cannot check in or report results, and leagues cannot award them points ([Adding Players Without an Account](https://help.start.gg/en/articles/13766139-adding-players-without-an-account)). Ranking edits publish at once; no version history is documented.
- API limited to 80 requests per 60 seconds ([Rate Limits](https://developer.start.gg/docs/rate-limits)); in January 2026 it made parry.gg remove start.gg account linking ([parry.gg blog](https://blog.parry.gg/01-16-2026-account-linking-update)).
- In Japan it is the tool of the majors: EVO Japan 2026 registration and the 篝火 (Kagaribi) Smash series run on it; a participant guide calls the UI "basically English" but switchable to Japanese ([Game\*Spark](https://www.gamespark.jp/article/2026/05/04/166021.html), [SmashWiki](https://www.ssbwiki.com/Kagaribi)).

### Challonge

- Acquisition by Logitech announced 2019-12-23 ([Play eSports](https://www.playesports.net/2019/12/23/challonge-reveals-acquisition-by-logitech/)); ownership since then is reported inconsistently and unverified.
- The broadest format set: round robin, Swiss, group stages ([Formats](https://kb.challonge.com/en/article/learn-about-challonge-competition-formats-1f8j1cf/)). Sign-up pages overflow into a waitlist, but registering needs a Challonge account ([Sign-Up Page](https://kb.challonge.com/en/article/hosting-a-sign-up-page-hsknjd/)). Community Elo rankings count display-name-only participants only on higher plans ([Community Ranking](https://kb.challonge.com/en/article/how-to-create-a-challonge-community-ranking-xjihi4/)). A community's collaborators change tournament settings but cannot open the community's settings, which admins can ([Community Roles](https://kb.challonge.com/en/article/community-roles-permissions-overview-g56p1n/)).
- $0.75 per paid order below the top plan (2025-12-16, [Hosting Paid Tournaments](https://kb.challonge.com/en/article/hosting-paid-tournaments-6ifalx/)); the API needs a paid plan above 500 requests a month since 2026-07-06 ([API docs](https://challonge.apidog.io/)).
- Largely replaced by start.gg in Smash ([SmashWiki](https://ssbwiki.com/Challonge)).

### parry.gg

- Launched around November 2024 under "The fastest way to run a tournament": live updates without a refresh, a node-based multi-phase editor, participants without accounts, a public API; single and double elimination and round robin, no Swiss ([organizers](https://parry.gg/organizers), [blog](https://blog.parry.gg/category/announcements)). Stripe payments for approved tournaments since 2026-03-13 ([release update](https://blog.parry.gg/release-update-03-13-2026)).
- On 2026-10-18 its front page listed 260- and 321-entrant events and Japanese Street Fighter 6 events ([parry.gg](https://parry.gg/)). It runs cobracket's own thesis — speed and a modern UI against start.gg — and started earlier.

### One axis each

- **Toornament**: relaunched 2025-02-18; a free tier, then Community (€19 a month billed annually), Circuit, and Arena; no Toornament fee on paid registration ([blog](https://blog.toornament.com/2025/02/toornament-evolves-with-a-new-tournament-platform-and-products-for-organizers/), [pricing](https://www.toornament.com/en_US/pricing)).
- **Battlefy**: join codes, check-in, four staff roles (bracket managers and moderators touch tournaments only; branding the organization takes an admin or the owner); no price list and no public API found ([Join Codes](https://help.battlefy.com/en/articles/2806705-use-join-codes-for-tournament-invites), [staff roles](https://help.battlefy.com/en/articles/2616693-what-can-my-staff-do-for-my-organization)).
- **Challengermode**: "infrastructure, not a consumer platform", white-label tournament systems for KRAFTON, Ubisoft and others; organizations and teams own Spaces that fans join or subscribe to — the closest existing thing to cobracket's Communities and team pages ([About](https://www.challengermode.com/about), [Spaces](https://support.challengermode.com/en/spaces/spaces)).
- **Matcherino**: crowdfunded prize pools and payouts, $5,330,852 paid over 15,022 tournaments as of 2026-10-18 ([matcherino.com](https://matcherino.com/)) — about $350 per tournament.
- **FACEIT**: a matchmaking and anti-cheat platform; acquired with ESL by Savvy Games Group in 2022 for $1.5B ([Wikipedia](https://en.wikipedia.org/wiki/FACEIT)).
- **Bracket HQ**: brackets only; free with ads up to 32 players, Pro at $8 a month ($4 billed annually) up to 64 ([pricing](https://brackethq.com/pricing/)).
- **Tourney** (iPhone): a bracket app with no login and a live bracket; 95 ratings averaging 4.3 on the Japanese App Store on 2026-10-18 ([App Store](https://apps.apple.com/jp/app/id6450659011)).

## Japan

### Tonamel (株式会社カヤック)

- Started 2017 as Lobi Tournament, renamed April 2020 ([terms](https://tonamel.com/terms), [KAYAC](https://kayac.com/en/news/2020/09/tonamel_arcrevo)). Over 1,000 tournaments a month in 2022; 3.2 million cumulative users by 2024-03-21; TCG tournaments up tenfold since 2021 ([4Gamer](https://www.4gamer.net/games/322/G032250/20220615011/), [財経新聞](https://www.zaikei.co.jp/releases/2403645/)).
- Formats: single elimination with a third-place match, double elimination with a reset, Swiss with tiebreaks, round robin, free-for-all; two phases and blocks; up to 256 entrants ([大会ページの作成](https://tonamel.com/help/create-tournament)).
- Registration first-come or by lottery (won, waitlisted, lost); online or QR check-in; the winner reports and the loser confirms; per-match chat and a "call the organizer" button; the bracket updates live ([抽選方法](https://tonamel.com/help/drawing-method), [QR](https://tonamel.com/help/offline-competitions), [当日の運営](https://tonamel.com/help/tutorial-for-organizing), [チャット](https://tonamel.com/help/how-to-use-chat), [Tonamelについて](https://tonamel.com/help/about-lobi-tournament)).
- Organizations: a leader and up to 20 members with permissions, plus a blacklist ([主催団体](https://tonamel.com/help/about-organization)).
- Revenue: ads, 5% + ¥100 per paid entry, 15% of sponsorship received, paid plans ([有料エントリー](https://tonamel.com/help/about-payment-entry), [エントリー料の振込](https://tonamel.com/help/transfer-entry-fee), [スポンサー料の振込](https://tonamel.com/help/receiving-sponsorship-tier)). No cross-tournament rankings.
- Participants need an account (Google, X, Facebook, Discord, LINE); people without one are added as guests and the organizer enters their results ([ログイン](https://tonamel.com/help/signup-login), [ゲスト](https://tonamel.com/help/about-guest-entry)). Guides to Japanese game tournaments name it as the place to recruit entrants ([b-conplaza](https://b-conplaza30th.jp/esports-japan/)).

### OFTN.GG (ワンフレーム株式会社)

- Beta 2025-07-01, general availability 2026-08-31 with over 2,700 tournaments hosted; 2,994 public events listed on 2026-10-18 ([PR TIMES](https://prtimes.jp/main/html/rd/p/000000016.000158970.html), [news](https://docs.oftn.gg/news), [oftn.gg](https://oftn.gg/)).
- Single and double elimination, round robin (up to 30), free-for-all; multi-phase progression without re-entering results; the bracket updates without a reload. **Participants join and watch from a shared URL without logging in**; organizers sign in with Google, Discord, or LINE ([plans](https://docs.oftn.gg/plans), [release](https://animeanime.jp/release/prtimes/20251226/264507.html), [login](https://oftn.gg/login)).
- Priced per tournament: free up to 32 players, Spot 64 at ¥1,480, Spot 256 at ¥4,980; phases, chat, check-in, and multiple admins sit on the paid tiers (2026-10-18, [plans](https://docs.oftn.gg/plans)).
- Its founder's motivation reads like cobracket's: no-shows, pairing mistakes, long waits, and Discord chat collapsing under simultaneous matches ([note](https://note.com/niroshi_of/n/n53989f567ff5)). Roadmap: team and organization accounts, season management, multiple languages ([PR TIMES](https://prtimes.jp/main/html/rd/p/000000016.000158970.html)).

### Also in Japan

- **JCG**: a publisher-facing tournament operator (Nippon TV decided to make it a subsidiary on 2023-09-05), not a self-serve tool; 20,000+ entries for a Pokémon TCG Pocket event ([GameBusiness](https://www.gamebusiness.jp/article/2023/09/05/22178.html), [gamebiz](https://gamebiz.jp/news/396750)).
- **スマメイト**: a Smash rating site with user-run tournaments; a Twitter account is required; unreachable from outside Japan since 2024 ([smashmate.net](https://smashmate.net/), [SmashWiki](https://www.ssbwiki.com/Smashmate)).
- Standalone newcomers rarely last: PLAYHERA JAPAN dissolved 2024-08-16, GameTector's domain no longer resolves, THE TOURNAMENT has not changed since 2017 ([gamebiz](https://gamebiz.jp/news/391585), [THE BRIDGE](https://thebridge.jp/2020/06/esports-platform-gametector-rim-seed-funding), [the-tournament.jp](https://the-tournament.jp/)).
- No Japanese service was found that is operated from an AI client or MCP, or that signs people in with an email one-time code.

### Law and publisher rules that bound fees and prizes in Japan

- **Gambling (刑法185条)**: JeSU's hosting manual warns that prize money drawn from entry fees can be judged gambling; the accepted shape is entry fees spent on operating costs and prizes funded by sponsors who do not play ([JeSU manual](https://jesu.or.jp/wp-content/themes/jesu/contents/pdf/terms/holding-manual20210921.pdf), [刑法185条](https://laws.e-gov.go.jp/api/1/articles;lawId=140AC0000000045;article=185)).
- **Nintendo community tournament guideline** (in force 2023-11-15): individual, non-commercial organizers only, and only adults may charge fees or give prizes; at most 300 participants online and 200 offline per organizer per day; entry fees offline only, at most ¥2,000 per person, spent on running the event with the accounts published; no online entry fee and no online spectator fee, offline spectator fee at most ¥1,500; prizes are goods or services only (no cash, vouchers, or e-money), worth at most about ¥500,000 per tournament and under ¥1,000,000 per organizer per year; no sponsors ([任天堂](https://www.nintendo.co.jp/tournament_guideline/index.html)). This covers Smash and Splatoon, the heart of cobracket's first audience.
- **Capcom community tournament guideline** (published 2026-04-28; prize rule relaxed 2026-07-23): no permission needed when followed, and tournaments run for profit or by companies are outside it; at most 64 participants when entry is paid and 256 when it is free; entry fee at most ¥2,000 per person, tax included, for running costs only; offline spectator fee at most ¥1,500; no third-party sponsors; prizes were certificates and trophies without monetary value until 2026-07-23, since then also goods not meant for cashing out or resale (regional specialties, food), with cash and vouchers still banned ([AUTOMATON](https://automaton-media.com/articles/newsjp/20260428-440217/), [電ファミニコゲーマー](https://news.denfaminicogamer.jp/news/2604282g), [ファミ通](https://www.famitsu.com/article/202607/82216)).
- **Riot** (LoL esports community competition guidelines, 2026-08-03): no fixed caps on entry fees, sponsorship revenue, prize pools, or ticketing; most events need no approval ([LoL Esports](https://lolesports.com/news/lol-esports-community-competition-guidelines)). Publisher rules differ by discipline, so anything built on entry fees or prizes is per discipline.
- **Funds settlement**: collecting money from users and paying it out to others is regulated activity; `docs/vision.md` already notes this for entry fees.

## Ranking tools and results hubs

- **Braacket** imports Challonge and smash.gg brackets, matches players by hand, and ranks with TrueSkill or points methods ([manual](https://braacket.com/usermanual/league); read from search excerpts only, the site returns 403).
- **start.gg** rankings and leagues as above: user-submitted, approval-gated leagues, ranking-fed seeding, no history.
- **Valve's Counter-Strike regional standings** publish dated snapshots, per-team breakdowns, and the model's code on GitHub — verifiable, but only Valve publishes and the model is fixed ([GitHub](https://github.com/ValveSoftware/counter-strike_regional_standings)). VLR.gg publishes no method ([VLR.gg](https://www.vlr.gg/rankings)); HLTV's is proprietary.
- **Smash**: UltRank was renamed LumiRank on 2023-08-04 and back on 2025-11-06; it counts weekly tournaments only when their organizer opts in and skips events whose organizer declined ([UltRank](https://www.ssbwiki.com/UltRank), [UltRank 2025](https://www.ssbwiki.com/UltRank_2025)). SSBMRank 2025 is a 23-person panel vote ([SmashWiki](https://www.ssbwiki.com/SSBMRank_2025)). PGStats.com went offline in mid-2025, Smashdata.gg stopped updating in mid-2024, OrionRank ended in 2022 ([PGStats.com](https://ssbwiki.com/PGStats.com), [Smashdata.gg](https://ssbwiki.com/Smashdata.gg), [OrionRank](https://ssbwiki.com/OrionRank)) — volunteer-run rankings die with their volunteers.
- **Japan**: JJPR seeds 篝火 ([note](https://note.com/harukisb/n/n70e67c7c583d)); Japan Smash Ranking published method ver7.0 on 2026-02-05 ([note](https://note.com/toki__ssbu/n/n7840dbf9a6a4)); SPSP is built for organizers' seeding, combining a placement rating with a Glicko-2 head-to-head rating ([SPSP](https://spsp.games/jp/overview)).
- **sendou.ink** (Splatoon) combines tournaments, automatic seeding, a rating ladder, and team profiles in one site — the loop closed for one game ([README](https://github.com/Sendouc/sendou.ink)).
- Precedents for ADR 0026's knobs: JJPR's smooth size function, UltRank reading the previous season's standings for field strength, and rankings referencing other publishers' rankings (UltRank used regional PRs; JSR uses LumiRank tiers).

## Chat, AI, and MCP

- **Whistle.day**: free, "No account required to start, no ads, no caps"; round robin, single and double elimination, Swiss, groups into a knockout; results reach brackets and projector screens in under a second; its MCP server exposes "the same 21 tools its screens use", with dry-run pairings, temporary accounts, and a claim link to hand the tournament to a person (MCP page dated 2026-10-05; listed on Smithery 2026-09-09) ([whistle.day](https://whistle.day/), [MCP](https://whistle.day/mcp), [Smithery](https://smithery.ai/servers/turon-honza/whistle-day)). Mostly sports, with an esports bracket page.
- **Turnale**: racket-sport tournaments run from Claude, ChatGPT (developer mode), Le Chat, Perplexity, Grok, and a Gemini CLI extension; players get one link, "Nothing to install, nothing to log into"; 35 languages ([turnale.app](https://www.turnale.app/)).
- **Turniermeister** (Austria): the AI sets a tournament up and hands it over by claim link (first seen 2026-09-06, [Glama](https://glama.ai/mcp/connectors/io.github.MartyMcFlyJr/turniermeister)).
- **Wizzrobe**: self-hosted, built for SpeedGaming; an OAuth MCP server beside a Discord bot, with 57 read and 67 write tools claimed, though the same document elsewhere counts 21 write tools ([GitHub](https://github.com/tcprescott/wizzrobe), [MCP doc](https://raw.githubusercontent.com/tcprescott/wizzrobe/main/docs/features/mcp-server.md)).
- Incumbents: no official MCP server found for start.gg, Challonge, Battlefy, Toornament, or Tonamel; community start.gg servers are read-only or report a winner only ([tomo789](https://github.com/tomo789/startgg-mcp-server), [magnusquest](https://github.com/magnusquest/startgg-mcp)), and Make Bracket Online's is read-only too ([makebracket-mcp](https://github.com/rocnubie/makebracket-mcp)); the official MCP registry returns nothing for "tournament" ([registry](https://registry.modelcontextprotocol.io/v0/servers?search=tournament&limit=100)). None of the newcomers publishes usage figures.
- Discord bots are the prehistory: Game.tv counted 1,600+ tournaments a day and about 100,000 servers across its whole service, Tourney bot included, in 2021 ([GameBusiness.jp](https://www.gamebusiness.jp/article/2021/02/13/18214.html)); the Challonge companion Lizard-BOT required Discord names to match Challonge names and was archived 2024-03-11 ([GitHub](https://github.com/lizardman301/Lizard-bot-rsf)).

## Registration tools and the do-it-yourself stack

- **Luma**: a name and an email from every guest, no account; one waitlist per event with host-approved promotion only; QR check-in; up to 30 clones at once; unlock codes; 5% on paid events on the free plan, 0% on Plus at $59 a month billed annually (2026-10-18); sign-in by a six-digit email code; no brackets or results ([registration](https://help.luma.com/p/event-registration-process), [waitlist](https://help.luma.com/p/waitlist.md), [check-in](https://help.luma.com/p/check-in), [recurring](https://help.luma.com/p/multi-session-recurring-events), [unlock codes](https://help.luma.com/p/unlock-codes), [pricing](https://luma.com/pricing), [sign-in codes](https://help.luma.com/p/not-receiving-emails), [events](https://help.luma.com/t/events)).
- **connpass**: per-slot lottery or first-come with a waitlist, QR attendance from the organizer's phone, no private events ([抽選](https://help.connpass.com/organizers/event-lottery.html), [FAQ](https://help.connpass.com/faq/event_organize.html)). **Doorkeeper**: waitlist, QR check-in app, convenience-store payment, no participant account ([features](https://www.doorkeeper.jp/features)). Discord scheduled events are RSVP only ([docs](https://docs.discord.com/developers/resources/guild-scheduled-event)).
- The Google Sheets bracket add-on tops out at 16 players with a 1.7 rating ([Marketplace](https://workspace.google.com/marketplace/app/tournament_brackets/413708349137)); the rest of the stack is forms, spreadsheets, and Discord, kept in sync by hand.

## Trading-card games and chess

- Sanctioned play runs on publisher-mandated tools: Wizards EventLink (which went down again at the January 2026 prerelease), Pokémon's TOM (2023 rules), Lorcana's Play Hub, BANDAI TCG+, KONAMI's systems; Riot moved Riftbound onto its own site on 2026-09-14 ([ICv2](https://icv2.com/articles/news/view/47562/wizards-coast-threatens-remove-stores-from-wpn-not-switching-wizards-eventlink), [ICv2](https://icv2.com/articles/columns/view/61427/rolling-initiative-thoughts-lorwyn-eclipsed-prerelease), [Play! Pokémon](https://www.pokemon.com/static-assets/content-assets/cms2/pdf/play-pokemon/rules/play-pokemon-championship-series-go-league-challenge-guidelines-09062023-en.pdf), [ICv2](https://icv2.com/articles/columns/view/58704/rolling-initiative-changes-disney-lorcana-organized-play-catan-6e-q-a), [BANDAI TCG+](https://apps.apple.com/hk/app/bandai-tcg/id1599299476), [KONAMI](https://www.konami.com/yugioh/guide/participation), [Riot](https://playriftbound.com/en-us/news/announcements/introducing-the-new-playriftboundcom)). A general platform can host only unsanctioned play.
- Unsanctioned: Melee.gg charges 8.99% (USD) or 10.99% (international) through its own payments, which tournaments up to 128 players may skip (2025-04-16), and merged with Best Coast Pairings in February 2026 ([Melee.gg](https://help.melee.gg/docs/game-changing-entry-fee-and-payment-policies-update-more-freedom-more-flexibility/), [ICv2](https://icv2.com/articles/news/view/61677/parent-company-melee-gg-keyrune-inc-merges-best-coast-pairings)); Limitless TCG is free with hand-updated series rankings and a public API ([docs](https://docs.limitlesstcg.com/organizer), [series](https://docs.limitlesstcg.com/organizer/series)); TopDeck.gg is $12 a month ([subscribe](https://topdeck.gg/subscribe)); Spicerack's shutdown was reported 2026-05-29 ([Cool Stuff Inc](https://www.coolstuffinc.com/a/week-in-magic-friday-may-29th-05292026)).
- Chess: Swiss-Manager and lichess Swiss events ([Swiss-Manager](https://swiss-manager.at), [lichess](https://lichess.org/swiss)); US Chess charges 35¢ per rated game ([US Chess](https://new.uschess.org/news/rating-fee-increase-effective-july-1)).
- Credibility here needs Swiss with game-specific tiebreaks and a top cut in one tournament, decklists, a round timer, lottery entry, and tolerance for a venue losing its connection. None of these tools is operated from AI, and none publishes ranking recalculation history.

## Physical sports

- Consolidation: PlayMetrics merged with Stack Sports on 2025-06-11 and completed the SportsEngine purchase on 2026-05-01 ([Ropes & Gray](https://www.ropesgray.com/en/news-and-events/news/2025/06/genstar-capital-supports-the-combination-of-playmetrics-and-stack-sports), [Next in the North](https://www.nextinthenorth.com/p/playmetrics-acquires-minneapolis-based-sportsengine)); LeagueApps shows public tournaments without a login and bought the youth-safety provider NCSI on 2026-07-08 ([LeagueApps](https://leagueapps.com/product-updates/), [YSBR](https://youthsportsbusinessreport.com/leagueapps-acquires-ncsi-the-youth-sports-safety-provider-left-out-of-the-sportsengine-sale/)); Tournify claims 300,000+ organizers, free up to 8 teams, then €40 or €120 per event ([about](https://tournifyapp.com/about), [pricing](https://help.tournifyapp.com/en/articles/8909534-pricing)).
- Japan: raquty Pro's spectator site drew about 13,000 unique visitors over a two-day soft-tennis national in April 2026 ([PR TIMES](https://prtimes.jp/main/html/rd/p/000000009.000160517.html)); P4match claims about 25,000 accounts and 2,000+ tournaments a year ([xexeq](https://xexeq.jp/blogs/media/topics42918)); a typical federation event still takes entries by email and post and ¥500 in cash at the desk ([熊本県高体連 要項](https://www.kumamoto-kotairen.jp/content/files/2026%20r08/soutai/youkou/06_sohuteni_soutai_youko.doc.pdf)).
- Ratings: UTR does not publish its formula ([FAQ](https://support.universaltennis.com/en/support/solutions/articles/9000233354)); USA Pickleball made DUPR its official rating on 2025-12-05 ([The Dink](https://www.thedinkpickleball.com/dupr-is-now-the-official-ratings-partner-of-usa-pickleball/)).
- Competing here needs court and time-slot scheduling, team matches, live scoring at the venue, convenience-store and cash payment, and minors' safety (Japan's DBS law takes effect 2026-12-25, [文部科学省](https://www.mext.go.jp/content/20251223-mxt_kyoikujinzai01-000046773_02.pdf)). The reachable layer is casual tournaments and clubs, where Whistle.day and Turnale already are.

## Fee benchmarks (2026-10-18)

| Service    | On a paid entry                                       |
| ---------- | ----------------------------------------------------- |
| start.gg   | 6%, paid by the participant on top (since 2025-02-14) |
| Tonamel    | 5% + ¥100 per entry; 15% of sponsorship received      |
| Challonge  | $0.75 per order (none on the top plan)                |
| Melee.gg   | 8.99% USD / 10.99% international through its payments |
| Luma       | 5% on the free plan, 0% on Plus ($59 a month, annual) |
| Toornament | none (paid tiers instead)                             |
| OFTN.GG    | none (priced per tournament)                          |

## cobracket's statements about competitors, checked

| Statement in cobracket's documents                                                | Verdict, 2026-10-18                                                                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Almost no existing tool offers chat operation                                     | No longer holds for the market (Whistle.day, Turnale, Turniermeister, Wizzrobe); still holds for every major platform                             |
| No existing app covers the whole loop                                             | Holds strictly; start.gg has most of it, sendou.ink closes it for one game                                                                        |
| Luma handles registration but knows nothing about brackets                        | Holds                                                                                                                                             |
| start.gg is heavy, dated, and account-first                                       | Account-first holds; "dated" is doubtful after the August 2026 app and 15 locales                                                                 |
| Participants and spectators have no live view of a bracket without accounts       | No longer holds (Tonamel for spectators, OFTN.GG, parry.gg, LeagueApps)                                                                           |
| Existing tools are slow, dated, and confusing                                     | Not verified either way; no neutral organizer reviews were collected                                                                              |
| Every tournament tool compared asks for an account before creating anything       | Holds for the incumbents compared (Luma, start.gg, Challonge); not for Whistle.day and Turniermeister (claim links) or the Tourney app (no login) |
| Free hosting of free-entry tournaments moves people off existing tools            | Weak: free hosting is the industry floor                                                                                                          |
| Luma: name and email from every guest, host-approved waitlist, clones up to 30    | Holds                                                                                                                                             |
| Luma: cancelling deletes the page; no drafts                                      | Not verified                                                                                                                                      |
| start.gg rankings are manual; leagues have tiered points and reasoned adjustments | Holds; starting a league also needs support's approval                                                                                            |
| UltRank is an independent ranking by people who organize nothing                  | Holds, but it honours an organizer who declines and counts weeklies only on opt-in                                                                |

The documents were brought in line with this table on 2026-10-22 (`docs/vision.md`, `docs/specs/mvp.md`, `docs/specs/events.md`, `CONTEXT.md`, and dated market notes in ADR 0001, 0024, and 0025).

## Re-check before relying on this again

- The MCP newcomers (Whistle.day, Turnale, Turniermeister): adoption, pricing, whether a major platform followed.
- OFTN.GG's roadmap (teams, seasons, languages), start.gg's fees and app, parry.gg's formats and pricing, Challonge's ownership.
- Not verified in this pass: organizer sentiment about any tool (no neutral reviews collected; several sites, including challonge.com, braacket.com, faceit.com, and HLTV, refuse automated reads), Braacket's history features, Luma's cancel and draft behavior.
