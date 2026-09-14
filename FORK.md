# Working on this fork

Ours now — we rebase onto upstream, never merge back. `AGENTS.md` covers the upstream project. What we
changed is `git diff upstream/main`; it is not repeated here.

```sh
git fetch upstream && git rebase upstream/main
```

## Keep the rebase cheap

- New behaviour → new files. Upstream never touches `server/review*.ts` or `ui/src/lib/Review*.svelte`.
- `ui/src/lib/PrDetail.svelte` is 200 KB, holds the tab bar, and upstream edits it constantly. Ours is
  exactly 3 lines — one import, one tab entry, one render block.
  Check: `git diff --stat upstream/main -- ui/src/lib/PrDetail.svelte`.
- Think you need a 4th line? You don't. ⌘5 wanted a key handler in there, so `ReviewShortcut.svelte`
  renders nothing and installs the listener itself; the Agents tab's turn helpers were worth reusing,
  so `agentTurns.js` holds a copy. Duplication beats a permanent conflict.
- `repo_slug="Zeit-AI/pr-cockpit"` in `scripts/bootstrap` must survive every rebase.

## Looks like a mistake, is deliberate

- Review runs take no `agent_runs`/`fixer_agents` row. `finishRun()` closes *every* running row for a
  PR, so sharing the table would kill a running fixer.
- Review storage sits beside `mirrors/`, `worktrees/`, `agents/` — never inside.
  `materializePrWorktree()` throws on a dirty worktree, and agent workdirs get swept.

## The agent prompt is code

Lives in `server/reviewAgent.ts`. After any edit, test live both ways:

- narrow question ("is this the house pattern?") → chat answer in seconds, no `index.html` written
- "quick overview" → still builds the page

Absolutes break it: *"Every question implies both"* made it render a full page for every trivial
question. Keep it short and high-level — a checklist in there produces template-shaped pages.

## Traps

- `webhooks.test.ts "migrates legacy window-keyed registrations"` fails only in the directory run.
  Upstream's, ignore it.
- Settings-writing tests hit the real `data/cockpit.db`, not a scratch dir. Establish the state you
  assert on, or the suite passes once and fails on the rerun.
- `tsc` is not a gate — dozens of pre-existing errors. Compare counts, don't expect zero.
- Scratch server, never take 4820:
  `COCKPIT_PORT=4899 COCKPIT_DATA_DIR=/tmp/cockpit-scratch COCKPIT_REPOS=owner/repo bun server/main.ts`
- Warm it before asking the review agent anything, or you get `mirror fetch dedup wait exceeded`:
  GET `/api/pr/<owner>/<repo>/<n>`, then `/diff`, then wait for `mirrors/<owner>__<repo>/HEAD`.
- Set `agent_harness: "claude"` on a scratch instance. It auto-detects `omp`, which fails with
  `No API key found for anthropic`.
- Installed app runs `COCKPIT_NO_BUILD=1`. UI change → `cd ui && bun run build` then ⌘R. Server change
  → `launchctl kickstart -k gui/$(id -u)/app.pr-cockpit.server`; a reload does nothing.
- launchd keeps a job's bootstrap environment, so editing a plist or `kickstart -k` will not repoint
  it — only `bootout` then `bootstrap`. If `scripts/install` stops on the port, free it and rerun
  install; it moves both agents, and doing one by hand leaves the app on the old build.
