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
# Installing Bun is limited to remote workspaces, where the toolchain belongs
# to a disposable image: $CLAUDE_CODE_REMOTE for Claude Code on the web,
# $CURSOR_CODE_REMOTE for Cursor. Both harnesses register this script, so
# checking only one of them would leave the other's hosted containers
# (`## Cursor Cloud specific instructions` in AGENTS.md) with neither the
# pinned Bun nor node_modules. Be aware that Cursor sets its variable for
# remote workspaces generally, not hosted agents specifically, so an SSH or
# dev-container workspace takes the install branch too; that is the closest
# signal either harness documents. On a personal machine the installer would
# replace whatever Bun the developer has globally, so there we report and stop
# instead — deliberately without installing dependencies, since resolving the
# lockfile with the wrong Bun is the damage this hook exists to prevent.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-${CURSOR_PROJECT_DIR:-$(dirname "$0")/../..}}"

pinned=$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"bun@\([^"+]*\).*/\1/p' package.json)
if [ -z "$pinned" ]; then
  echo "session-start: no bun@ version in package.json packageManager; skipping." >&2
  exit 0
fi

# check:bun owns the comparison (engines.bun range, pin shape, corepack hash).
if bun run check:bun >/dev/null 2>&1; then
  echo "session-start: Bun $(bun --version) is supported."
elif [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || [ "${CURSOR_CODE_REMOTE:-}" = "true" ]; then
  echo "session-start: Bun $(bun --version 2>/dev/null || echo "not found") is unsupported here; installing the pinned bun@${pinned}."
  # A failed install must not take the session down with it, and must not fall
  # through to `bun install` either: the wrong Bun rewriting bun.lock is the
  # damage this hook exists to prevent. Report, leave the tree alone, let the
  # agent hit check:bun with a clear message on its first command.
  if ! curl -fsSL https://bun.sh/install | bash -s "bun-v${pinned}"; then
    echo "session-start: installing bun@${pinned} failed. Bun left as-is and dependencies" >&2
    echo "  not installed; run check:bun before anything that writes bun.lock." >&2
    exit 0
  fi
  # The installer writes to $BUN_INSTALL/bin and exports PATH in its own
  # subshell, which dies with the pipe. Unless that directory already holds
  # the `bun` the shell resolves — true in this repo's Claude container only
  # because /usr/local/bin/bun symlinks into it — every later command would
  # still get the image's Bun, and the check below would fail on the binary
  # that was just replaced. Put it in front explicitly, and persist it for the
  # rest of the session where the harness offers somewhere to write it (Claude
  # Code does; Cursor documents no equivalent, so there a later shell falls
  # back to whatever the image resolves and check:bun is what catches it).
  bun_bin="${BUN_INSTALL:-$HOME/.bun}/bin"
  export PATH="$bun_bin:$PATH"
  hash -r
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    printf 'export PATH="%s:$PATH"\n' "$bun_bin" >> "$CLAUDE_ENV_FILE"
  fi
  if ! bun run check:bun; then
    echo "session-start: bun@${pinned} installed but still does not satisfy engines.bun;" >&2
    echo "  dependencies not installed." >&2
    exit 0
  fi
else
  echo "session-start: Bun $(bun --version 2>/dev/null || echo "not found") does not satisfy engines.bun, and this is not a remote" >&2
  echo "  workspace, so Bun was left alone. Install bun@${pinned} before running anything that" >&2
  echo "  writes bun.lock:" >&2
  echo "    curl -fsSL https://bun.sh/install | bash -s \"bun-v${pinned}\"" >&2
  exit 0
fi

# --frozen-lockfile so setting a session up cannot rewrite the artifact the
# rest of this hook exists to protect. A plain `bun install` would resolve and
# save the lock whenever package.json has moved ahead of it, which is exactly
# the silent lockfile rewrite guarded against above — only by the right Bun
# instead of the wrong one. When they disagree the session still opens; the
# regeneration is a deliberate act, not session setup.
if ! bun install --frozen-lockfile; then
  echo "session-start: bun.lock does not match package.json, so dependencies were not installed." >&2
  echo "  Run \`bun install\` deliberately and commit the regenerated lockfile." >&2
  exit 0
fi
