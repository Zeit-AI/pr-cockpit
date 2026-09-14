# Working on this fork

Zeit AI's fork of `theolundqvist/pr-cockpit`. Read `AGENTS.md` for the upstream project; this file is
only what is different here, and what has already bitten us.

Own file on purpose. Every line added to an upstream file is a line that can conflict on the next
merge, so fork-specific docs live here rather than in `AGENTS.md`.

## The one rule that matters

New behaviour goes in new files. `server/review*.ts`, `ui/src/lib/Review*.svelte` — upstream will
never touch those, so they never conflict.

`ui/src/lib/PrDetail.svelte` is 200 KB in one file and holds the tab bar, which means upstream edits
it constantly and so do we. It is held to **exactly three lines**: one import, one tab entry, one
render block. Check before committing:

```sh
git diff --stat upstream/main -- ui/src/lib/PrDetail.svelte   # must say 3 insertions
```

If a change seems to need a fourth line, it doesn't. The ⌘5 shortcut needed a key handler in there;
instead `ReviewShortcut.svelte` renders nothing and installs the listener itself. The Agents tab's
turn-rendering helpers were worth reusing; instead `agentTurns.js` holds a copy and PrDetail keeps its
own. Duplicating ten lines is cheaper than a permanent merge conflict. Do the same next time.

## What we added, and where

Review tab: a per-PR chat with an agent that reads the whole repo at PR head and maintains a visual
`index.html` rendered in an iframe beside the chat.

- `server/reviews.ts` — storage, transcript, meta, path safety for served files.
- `server/reviewAgent.ts` — the queue, the harness spawn, and **the system prompt**.
- `server/reviewConfig.ts` — model, thinking effort, per-repo notes.
- `server/http.ts` — routes, `/review/...` and `/api/review/...` both work.
- `ui/src/lib/ReviewTab.svelte`, `ReviewTurns.svelte`, `ReviewShortcut.svelte`, `reviewPrompts.js`,
  `agentTurns.js`.
- Sentry is deliberately gone from `server/main.ts`.

Storage is `$COCKPIT_DATA_DIR/reviews/<owner>__<repo>/pr-<N>/`. It has to be a sibling of
`mirrors/`, `worktrees/` and `agents/`, never inside one: `materializePrWorktree()` throws if the
worktree is dirty, and the agent sweeps delete agent workdirs. Nothing sweeps `reviews/`. Keep it
that way, and keep the review agent read-only against the PR worktree.

Review runs deliberately take no `agent_runs` or `fixer_agents` row. `finishRun()` updates *every*
running row for a `(repo, number)`, so a review run sharing the table would close a concurrently
running fixer's row. Don't "tidy" this later.

## Changing the agent's prompt

It is in `server/reviewAgent.ts`. Prompt text is behaviour, so test it live, both directions:

- a narrow question ("is this the house pattern here?") must answer in chat in seconds and write **no**
  `index.html`;
- "Give me a quick overview" must still build the page.

One phrase caused a real bug: *"Every question implies both"* made it render a full page for every
trivial question. Watch for absolutes like that. Keep the prompt short and high-level — a checklist in
there produces template-shaped pages regardless of the PR.

## Testing

```sh
bun test server/reviews.test.ts        # targeted, while iterating
bun test server/                       # everything
```

`webhooks.test.ts "migrates legacy window-keyed registrations"` fails in the directory run and passes
alone. That's upstream's, documented in `AGENTS.md`, ignore it. Anything else failing is yours.

Two traps we already hit. Settings-writing tests write to the **real** `data/cockpit.db`, not to a
scratch dir — so establish the state you assert on instead of assuming it, or the suite passes once
and fails on the second run. And `tsc` is not a gate: the repo carries dozens of pre-existing
errors (`tsc --noEmit | grep -c "error TS"`). Compare that count before and after your change rather
than expecting zero.

## Running it

Never take port 4820 or the real data dir. Start your own:

```sh
COCKPIT_PORT=4899 COCKPIT_DATA_DIR=/tmp/cockpit-scratch COCKPIT_REPOS="owner/repo" bun server/main.ts
```

Before asking the review agent anything on a fresh scratch instance, warm the cache or it fails with
`mirror fetch dedup wait exceeded`: fetch `/api/pr/<owner>/<repo>/<n>`, then `/diff`, then wait for
`$COCKPIT_DATA_DIR/mirrors/<owner>__<repo>/HEAD` to exist. The clone is ~60 MB and takes a minute.

Also set the harness on a scratch instance: `agent_harness` auto-detects `omp` if `~/.bun/bin/omp`
exists, and an unauthenticated omp fails with `No API key found for anthropic`. PUT `/api/settings`
with `agent_harness: "claude"`.

## Getting a change onto the installed app

The launch agent runs with `COCKPIT_NO_BUILD=1`, so nothing rebuilds for you.

- UI change: `cd ui && bun run build`, then ⌘R in the app.
- Server change: `launchctl kickstart -k gui/$(id -u)/app.pr-cockpit.server`. A reload does nothing.
- Shell change: quit and relaunch the app.

Don't hand-patch launchd. A loaded job keeps the environment it was bootstrapped with, so rewriting a
plist changes nothing and `kickstart -k` changes nothing — only `bootout` then `bootstrap` does. This
cost us twice: after repointing the install, the app kept launching the old build from `~/.pr-cockpit`
because only the server agent had been reloaded. `scripts/install` already moves **both** agents when
the root changes; it just never reached that code, because its port-conflict `exit 1` sits ahead of
it. So if install stops at the last stage, free the port and rerun install — never reload agents by
hand.

## Workflow

Direct to `main`, small commits, push each one immediately. No PRs, no feature branches — that is
upstream's rule in `AGENTS.md` and it still holds here.

Taking upstream changes is deliberate:

```sh
git fetch upstream && git merge upstream/main
```

One line must survive that merge: `repo_slug="Zeit-AI/pr-cockpit"` in `scripts/bootstrap`. A fork's
installer has to install the fork. A conflict there is the signal to check it still points at us.
