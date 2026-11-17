# Stage 3b — rules for every build agent

You build ONE task of stage 3b "BIOLOGICAL SYSTEMS" (technical level 4) of COLD BOOT (three.js r187, TypeScript, Vite).

1. Read: `CLAUDE.md`; `docs/plans/stage-3b.md` — §0, your task's row in §11, every section it cites, and §13 (changes
   after review; it wins where it differs); `docs/plans/stage-3b-k-notes.md` (what the contract task left for you);
   `src/core/types.ts` (the contract). The plan is authoritative: do not invent coordinates, ids, numbers or text it
   gives. Where it is silent or wrong, decide, and list the decision in your report.
2. You work in your own git worktree. NEVER run git commands that change anything (no add/commit/stash/checkout);
   the coordinator merges your uncommitted work as a patch. Edit ONLY the files your §11 row owns. If you need a
   change in a file you do not own (a contract member, a shared helper), do not make it: describe the exact change
   in your report (the one exception: a file your row explicitly lists).
3. Other agents build the other tasks at the same time, in other worktrees, on the same machine. So:
   - build into YOUR OWN directory: `npx vite build --outDir <scratchpad>/dist-<task id> --emptyOutDir`, preview with
     `npx vite preview --outDir <that dir> --port <your port> --strictPort --host 127.0.0.1`; never use port 5173 or
     the shared `dist`; never touch another agent's server;
   - headless-browser runs are expensive and falsify each other's timing: run your own test and the one or two
     existing checks your change can really affect, one at a time — NOT the whole suite (the coordinator runs the
     full checklist from a frozen copy at the merge point);
   - stop every server and process you started before you finish.
4. Levels 1–3 must behave exactly as before unless your row says otherwise.
5. Lessons from the user's play of stage 3a, binding for everything new: characters and props are placed from level
   markers, never from story-side coordinates; timed gestures/beats start with their spoken line (≤ 0.12 s), from
   recorded durations; no glow or particle volume may be visible through a gap or a pane from an unintended place;
   in-person speech is audible at distance and never occluded by the speaker's own body; after lights-out the level
   stays readable by flashlight on LOW and MEDIUM; 60 fps on LOW/MEDIUM within the plan's per-space budgets.
6. Look at what you built (screenshots with `scripts/shot.mjs` or your dev page) and fix what reads wrong before
   reporting. Nobody can listen to sounds or voices but the user: for audio, report what to listen to.
7. Final report (short): files changed; decisions the plan did not spell out; changes you need in files you do not
   own; checks run with results (and from which build); an honest "still weak" list.
