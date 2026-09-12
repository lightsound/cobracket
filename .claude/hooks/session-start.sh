#!/bin/bash
# Session setup, registered for Claude Code (SessionStart) and Cursor
# (sessionStart). Two jobs, in order:
#
#   1. Make sure the running Bun is one this project supports. Bun enforces
#      neither `packageManager` nor `engines.bun`, and the hosted agent images
#      ship whatever Bun they were built with — so without this every session
#      starts on an unsupported version and resolves bun.lock with it.
#   2. Install dependencies, so tests and linters work without the agent
#      discovering it has to run `bun install` first.
#
# The version is read from `packageManager`, never restated here: it is the
# single declaration in this repository and `scripts/check-bun-version.ts`
# guards it.
#
# Installing Bun is limited to hosted agent containers ($CLAUDE_CODE_REMOTE),
# which are ephemeral. On a personal machine the installer would replace
# whatever Bun the developer has globally, so there we report and stop instead
# — deliberately without running `bun install`, since resolving the lockfile
# with the wrong Bun is the damage this hook exists to prevent.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

pinned=$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"bun@\([^"+]*\).*/\1/p' package.json)
if [ -z "$pinned" ]; then
  echo "session-start: no bun@ version in package.json packageManager; skipping." >&2
  exit 0
fi

# check:bun owns the comparison (engines.bun range, pin shape, corepack hash).
if bun run check:bun >/dev/null 2>&1; then
  echo "session-start: Bun $(bun --version) is supported."
elif [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  echo "session-start: Bun $(bun --version) is unsupported here; installing the pinned bun@${pinned}."
  # A failed install must not take the session down with it, and must not fall
  # through to `bun install` either: the wrong Bun rewriting bun.lock is the
  # damage this hook exists to prevent. Report, leave the tree alone, let the
  # agent hit check:bun with a clear message on its first command.
  if ! curl -fsSL https://bun.sh/install | bash -s "bun-v${pinned}"; then
    echo "session-start: installing bun@${pinned} failed. Bun left as-is and dependencies" >&2
    echo "  not installed; run check:bun before anything that writes bun.lock." >&2
    exit 0
  fi
  hash -r
  if ! bun run check:bun; then
    echo "session-start: bun@${pinned} installed but still does not satisfy engines.bun;" >&2
    echo "  dependencies not installed." >&2
    exit 0
  fi
else
  echo "session-start: Bun $(bun --version) does not satisfy engines.bun, and this is not a hosted" >&2
  echo "  agent container, so Bun was left alone. Install bun@${pinned} before running anything that" >&2
  echo "  writes bun.lock:" >&2
  echo "    curl -fsSL https://bun.sh/install | bash -s \"bun-v${pinned}\"" >&2
  exit 0
fi

bun install
