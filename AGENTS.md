# AGENTS.md

This file gives coding agents project-specific context. Keep it short and update it when workflows change.

## Language Policy

- Everything committed to this repo must be in **English**: code, comments, docs, commit messages, PR titles and bodies.
- Exception: `docs/solid2-migration-from-react-ja.md` is a vendored Japanese reference (in-depth React-to-Solid 2.0 guide; read it when a Solid design decision is unclear) — keep it as is.
- Chat with the user in **Japanese**. This applies to conversation only, never to repo artifacts.

## Project Overview

- Primary app: cobracket, a Solid 2.0 `bare` app with a Convex task list
- Main entry points: `src/App.tsx`, `src/Document.tsx` (Solid start convention, no `index.html`), `convex/schema.ts`, `convex/tasks.ts`
- Important directories: `src/` (UI), `convex/` (backend functions)

## Architecture Notes

- Module boundaries: browser code stays in `src/`; Convex queries and mutations stay in `convex/`
- Generated or vendored code: `convex/_generated/` (from `bun run convex:dev` / `bun run convex:codegen`). Do not edit by hand
- Sensitive areas: `vite.config.ts` must keep `host: '0.0.0.0'` for Cursor's preview. Keep `solid({ start: { devtools: false } })` unless `@solidjs/start-devtools` is installed

## Commands

- Install: `bun install`
- Dev: `bun run convex:dev` and `bun dev` (two processes)
- Build: `bun run build`
- Typecheck: `bunx tsc --noEmit`
- Solid pattern guard: `bun run lint:solid` (blocks React / Solid 1.x patterns in `src/`)
- Update Solid agent guidance: `bunx solid2-kit sync` (rules, skills, and the managed AGENTS.md/CLAUDE.md blocks are owned by [solid2-agent-kit](https://github.com/lightsound/solid2-agent-kit); do not edit them by hand)
- Fallow: `bun run fallow` (full), `bun run fallow:audit` (changed files)

## Fallow

- Rules are all `error` except `coverage-gaps` (`off` until tests exist). Do not demote a rule to warn; turn it off only if the finding cannot be true for this repo, and say why in `.fallowrc.jsonc`.
- Use `fallow audit --format json --quiet` before committing AI-generated changes.
- Use `fallow dead-code --format json --quiet`, `fallow dupes --format json --quiet`, and `fallow health --format json --quiet` for targeted checks.
- Use `fallow list --entry-points --format json --quiet` and `fallow list --boundaries --format json --quiet` to inspect project shape.
- Solid 2 start mode has no `src/main.tsx`. Keep `src/App.tsx` and `src/Document.tsx` in `.fallowrc.jsonc` `entry` or they look unused.

<!-- generated:task-matrix:start -->
| When the agent is about to... | Run |
|---|---|
| delete an "unused" export or file | `fallow dead-code --trace <file>:<export>` |
| prove a TypeScript symbol's exact consumers before refactoring | `fallow dead-code --type-aware --symbol-impact <file>:<export-or-class.method>` |
| delete an "unused" dependency | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR | `fallow audit --base <ref>` |
| prioritize refactoring | `fallow health --hotspots --targets` |
| ask who owns code | `fallow health --ownership` |
| check untested-but-reachable code | `fallow health --coverage-gaps` |
| consolidate duplication | `fallow dupes --trace dup:<fingerprint>` |
| find feature flags | `fallow flags` |
| check which architecture rules apply to a file before changing it | `fallow guard <files>` |
| surface security candidates | `fallow security` |
| understand a finding | `fallow explain <issue-type>` |
| scope a monorepo | `--workspace <glob> / --changed-workspaces <ref>` (global flags, prefix any command) |
<!-- generated:task-matrix:end -->

## Agent Rules

- Do not edit `convex/_generated/`
- Do not change `host: '0.0.0.0'` or re-enable Solid devtools without installing its optional peer
- Package manager is Bun 1.4 (`bun.lock`). Do not add npm or pnpm lockfiles

<!-- solid2-agent-kit:agents-section:start -->
<!-- Managed by solid2-agent-kit v0.3.0. Do not edit inside this block; run `solid2-kit sync` to update. -->

## Solid 2.0 (not React, not Solid 1.x)

- All TSX in this project is Solid 2.0. Components run **once**; reactivity flows through signals/stores to JSX. React patterns (props destructuring, `className`, per-keystroke `onChange`, state-synced-by-effect, `.map()` lists) and Solid 1.x APIs (`createResource`, `onMount`, `solid-js/store`, `Suspense`, path setters) are bugs here.
- Before writing TSX, read the `solid-2` skill (`.cursor/skills/solid-2/SKILL.md` for Cursor, `.claude/skills/solid-2/SKILL.md` for Claude Code): patterns, decision tables, official doc URLs. Hard rules auto-attach from `.cursor/rules/solid-2.mdc` in Cursor and live in a managed block in `CLAUDE.md` for Claude Code.
- After editing TSX, run the `solid2-kit check` mechanical gate — it fails on React/Solid 1.x tokens and props destructuring. Use the project's `lint:solid` script if one exists; otherwise `npx solid2-agent-kit check` (with the kit as a devDependency) or `npx github:lightsound/solid2-agent-kit check`. Do not install `eslint-plugin-solid` (built for Solid 1.x; misreads Solid 2 idioms).
- Solid 2.0 shipped recently and breaks with 1.x — never trust pre-2.0 Solid docs, tutorials, or training knowledge. Verify APIs against https://v2-rebuild--solid-docs-v2.netlify.app/llms.txt (markdown mirror of https://v2.solidjs.com/, which blocks non-browser fetchers).

<!-- solid2-agent-kit:agents-section:end -->
