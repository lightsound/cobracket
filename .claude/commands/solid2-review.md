Review the current change set for Solid 2.0 correctness. This project bans React patterns
and Solid 1.x APIs; the mechanical gates catch tokens, but several failure classes are
semantic and need your judgment.

Steps:

1. Run the gates and fix anything they report first:
   - `node node_modules/solid2-agent-kit/bin/solid2-kit.mjs check`
   - `node node_modules/solid2-agent-kit/bin/solid2-kit.mjs doctor`
2. Read the `solid-2` skill (`.cursor/skills/solid-2/SKILL.md` or
   `.claude/skills/solid-2/SKILL.md`) and its final review checklist.
3. Collect the diff under review: staged/uncommitted changes if any, otherwise the branch
   diff against the default branch.
4. Review every changed `.tsx`/`.jsx`/`.ts` file against the checklist, prioritizing what
   regexes cannot see:
   - reactive reads at component-body top level, or extracted into plain `const`s;
   - async computations reading reactive inputs **after** the first `await`;
   - effects that copy state instead of deriving it, or reading stores in the apply phase;
   - `<For>` over server/refetched rows without a stable-id key function;
   - `<Loading>`/`<Errored>` wrapping page chrome instead of the data slot, or async memos
     passed as values (`user={user()}`) instead of accessors;
   - store updates that rebuild objects/arrays instead of mutating the draft or reconciling;
   - context values passed as snapshots instead of accessors/setters/stores;
   - components with conditional/early returns on reactive values.
5. Verify any API you are not certain about against the official docs mirror
   (`https://v2-rebuild--solid-docs-v2.netlify.app/llms.txt`); never trust Solid 1.x or
   React memory.

Report each finding as `file:line — problem — Solid 2 replacement`, then fix them. Finish
by re-running the gates and the project's typecheck.
