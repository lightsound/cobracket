# Chat operations ship as an MCP server first

Timing amended by [ADR 0009](./0009-defer-mcp-surface.md): the MCP surface is deferred out of the MVP slice; the single-operations-API constraint and the surface ordering below stay in force.

Market note (2026-10-22): "almost no existing tournament tool offers it" held for the major platforms (start.gg, Challonge, Battlefy, Toornament, Tonamel) but not for the market by October 2026 — Whistle.day, Turnale, and Turniermeister ship write-capable MCP servers, and the self-hosted Wizzrobe has one ([`docs/competitors.md`](../competitors.md)). The decision stands on its other ground: one operations API, every chat surface a thin wrapper over it.

cobracket's differentiator is that an Organizer can run a tournament from chat. We design one operations API covering everything an Organizer can do, and expose it first through an MCP server, so users drive tournaments from their own AI client. Every later chat surface must stay a thin wrapper over that same operations API.

## Considered Options

- **Discord bot first**: closest to the game-community audience, but heavier to build and host; planned as the likely second surface, not the first.
- **In-app AI assistant**: duplicates what the web UI already does; deliberately last.
- **MCP server first (chosen)**: thinnest possible wrapper over the operations API, and almost no existing tournament tool offers it.
