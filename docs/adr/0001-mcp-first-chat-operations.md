# Chat operations ship as an MCP server first

cobracket's differentiator is that an Organizer can run a tournament from chat. We design one operations API covering everything an Organizer can do, and expose it first through an MCP server, so users drive tournaments from their own AI client. Every later chat surface must stay a thin wrapper over that same operations API.

## Considered Options

- **Discord bot first**: closest to the game-community audience, but heavier to build and host; planned as the likely second surface, not the first.
- **In-app AI assistant**: duplicates what the web UI already does; deliberately last.
- **MCP server first (chosen)**: thinnest possible wrapper over the operations API, and almost no existing tournament tool offers it.
