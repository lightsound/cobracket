# AGENTS.md

This file gives coding agents project-specific context. Keep it short and update it when workflows change.

## Project Overview

- Primary app: cobracket, a Solid 2.0 `bare` app with a Convex task list
- Main entry points: `src/App.tsx`, `src/Document.tsx` (Solid start convention, no `index.html`), `convex/schema.ts`, `convex/tasks.ts`
- Important directories: `src/` (UI), `convex/` (backend functions)

## Architecture Notes

- Module boundaries: browser code stays in `src/`; Convex queries and mutations stay in `convex/`
- Generated or vendored code: `convex/_generated/` (from `bun run convex:dev` / `bun run convex:codegen`). Do not edit by hand
- Sensitive areas: `vite.config.ts` preview HTML buffering and `host: '0.0.0.0'` are required for Cursor's preview. Do not revert them. Keep `solid({ start: { devtools: false } })` unless `@solidjs/start-devtools` is installed

## Commands

- Install: `bun install`
- Dev: `bun run convex:dev` and `bun dev` (two processes)
- Build: `bun run build`
- Typecheck: `bunx tsc --noEmit`
- Fallow: `bun run fallow` (full), `bun run fallow:audit` (changed files)

## Fallow

- Use `fallow audit --format json --quiet` before committing AI-generated changes.
- Use `fallow dead-code --format json --quiet`, `fallow dupes --format json --quiet`, and `fallow health --format json --quiet` for targeted checks.
- Use `fallow list --entry-points --format json --quiet` and `fallow list --boundaries --format json --quiet` to inspect project shape.
- Solid 2 start mode has no `src/main.tsx`. Keep `src/App.tsx` and `src/Document.tsx` in `.fallowrc.json` `entry` or they look unused.

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
- Do not revert the Cursor preview workarounds in `vite.config.ts`
- Package manager is Bun 1.4 (`bun.lock`). Do not add npm or pnpm lockfiles
