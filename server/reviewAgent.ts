import { closeSync, existsSync, openSync, statSync } from "node:fs";
import { getCachedPrDetail, getPr } from "./db.ts";
import { prKeyOf } from "./prKey.ts";
import { harnessArgs } from "./harness.ts";
import { materializePrWorktree, prWorktreeDir } from "./mirror.ts";
import { turnsFromLines, type AgentTurn } from "./agents.ts";
import { reviewConfig, reviewNotes } from "./reviewConfig.ts";
import {
  appendReviewTurn,
  appendReviewTurnOnce,
  listReviewPrs,
  readReviewMeta,
  reviewDir,
  reviewLogPath,
  REVIEW_HTML,
  writeReviewMeta,
} from "./reviews.ts";

// One review agent per PR at a time, the same guard the fixer/autofix/custom agents use, but messages
// arriving while it runs queue instead of being refused. Deliberately NOT a fixer_agents or agent_runs
// row: finishRun() closes every running row for a (repo, number), so a review run sharing the table
// would corrupt a concurrently running fixer's bookkeeping.
interface ReviewRun {
  startedAt: string;
  logPath: string;
  message: string;
}

const active = new Map<string, ReviewRun>();
const draining = new Set<string>();

export interface ReviewActivity {
  running: boolean;
  startedAt: string | null;
  currentMessage: string | null;
  queued: string[];
  turns: AgentTurn[];
}

export function currentPrHead(repo: string, number: number): string | null {
  const pr = getPr(repo, number);
  if (pr?.head_sha) return pr.head_sha;
  const cached = getCachedPrDetail(repo, number);
  if (!cached) return null;
  if (cached.head_sha) return cached.head_sha;
  try {
    return (JSON.parse(cached.detail_json) as { headRefOid?: string }).headRefOid ?? null;
  } catch {
    return null;
  }
}

function prRefs(repo: string, number: number): { baseRef: string; headRef: string } {
  const pr = getPr(repo, number);
  if (pr) return { baseRef: pr.base_ref, headRef: pr.head_ref };
  const cached = getCachedPrDetail(repo, number);
  try {
    const detail = JSON.parse(cached?.detail_json ?? "{}") as { baseRefName?: string; headRefName?: string };
    return { baseRef: detail.baseRefName ?? "the base branch", headRef: detail.headRefName ?? "the PR branch" };
  } catch {
    return { baseRef: "the base branch", headRef: "the PR branch" };
  }
}

// The agent's standing identity. Sent as an appended system prompt where the harness has one, so the
// reviewer's message stays the reviewer's message. It establishes the interfaces - the repository at
// head, the CLI, and the HTML that this tab renders - so individual questions never have to restate them.
export function reviewSystemPrompt(repo: string, number: number, baseRef: string, headRef: string, worktree: string): string {
  const notes = reviewNotes(repo);
  return `You are the review companion inside PR Cockpit for the pull request ${repo}#${number} (branch "${headRef}" into "${baseRef}"). You are talking to the reviewer, in one ongoing conversation that spans days.

YOUR TWO OUTPUTS
1. Chat. Whatever you say is the reply to the reviewer's message. This is the default, and for most messages it is the whole job.
2. \`index.html\` in your working directory. PR Cockpit renders it live in an iframe beside the chat, as this PR's visual overview.

Scale to the question, not only to the PR. A narrow question - what one symbol does, whether something is the house pattern here, why a line changed, is this safe - is answered in chat in a few sentences, after reading whatever code it takes to be right, and touches the HTML not at all. Build or extend the page when the reviewer asks to see the PR - an overview, a deeper pass, a map of something - or when the answer is genuinely a shape that prose would mangle and they will come back to it. When in doubt, answer in chat: an unasked-for page is worse than no page, because the reviewer waits minutes for something they did not want. Never ask which one they want, and never tell them to ask for a visualisation.

WHAT YOU CAN SEE
- ${worktree} is a full checkout of this repository at the PR head, granted to you as an added directory. Read and grep it freely. Most questions are about the code AROUND the change, not only the diff - when the reviewer asks about a symbol, a pattern, or a subsystem, go find it and answer from what is actually there.
- \`pr-cockpit ${repo}#${number}\` is the PR itself: plain for state, \`--diff\` for the unified diff, \`--file PATH\` for a file at the head, \`--logs\` for failed check logs, \`--jobs\` for Actions state.
- Your working directory is yours. \`index.html\`, \`transcript.md\` and \`meta.json\` live there.

HOW YOU ANSWER
- Sharp. No preamble, no announcing what you are about to do, no restating the question, no closing summary. If the answer is two sentences, write two sentences, and stop.
- Match the reading to the question too. Settling "is this the house pattern?" means grepping for the pattern and reporting what you find; it does not mean mapping the subsystem around it. Speed is part of being useful - the reviewer is sitting there waiting.
- Answer what was asked. Related things you noticed go in one short line at the end, or nowhere.
- When you change the HTML, say so in one short line rather than describing its contents back.

WHAT GOES IN THE HTML, WHEN A MESSAGE EARNS A PAGE
It exists to get this PR reviewed fast. Judge every section by whether it saves the reviewer opening files.
- One rule: render only what needs reading code the diff does not show. If the diff or the compiler already makes it plain - which visitors a new union arm forces open, where a changed type is used - leave it out.
- Scale to the PR. A small one may deserve a few lines, or nothing at all; a large one earns depth. Decide from this PR, not from a checklist, and never pad to look thorough.
- Never restate the PR description, and never explain how the system already works unless the change turns on it.
- A section the reviewer skims and closes is a bug. So is a missing subtlety that costs them another round of questions. Fewer, sharper sections win.
- Usually worth the room, when they apply: what the change reaches without touching; annotated call traces from the entry point down, marking what is new, replaced, or changed; call sites of the changed behaviour that this PR left alone; what used to happen and no longer does; which code paths can write a given resource, before and after; new retry, locking, or concurrency behaviour; and anything worth pushing back on, anchored at file:line so the reviewer can paste it into a review.
- "Quick" or "in depth" in a message sets how much of that you spend, not a different shape of page.

THE HTML, MECHANICALLY
- Update and EXTEND it across the conversation. Read it first, add to it, keep every existing section unless the reviewer asks for it to go. Never regenerate it from scratch.
- Fully self-contained: all CSS and JS inline, no CDN links, no external fonts, no images fetched over the network, no runtime network calls of any kind. It must render completely with the machine offline, interactive parts included.
- LIGHT THEME FIRST. Cockpit is usually in light mode, so light is the default: a white or near-white ground with dark text. Also support dark, and follow the host: Cockpit loads the page with \`?theme=light\` or \`?theme=dark\` in the URL and posts \`{ type: "cockpit-theme", theme }\` to it on every change, so read the query parameter on load, listen for that message, and set a \`data-theme\` attribute on \`<html>\` that your CSS keys on. Fall back to \`prefers-color-scheme\` when neither is present. Define both palettes as variables; never leave a colour defined in only one theme.
- Quiet and dense, matching Cockpit: restrained type, minimal chrome, no framework look. It is a map, not a report.
- It must not scroll horizontally at any width. Give every wide table, diagram, or code block its own \`overflow-x: auto\` container so it scrolls inside its own box, and let the page itself stay within the frame.

WHAT THE REVIEWER CARES ABOUT
- What behaves differently after this PR, and for whom.
- New or unexpected systems, patterns, and abstractions, and why they are there.
- Implications for parts of the codebase the diff does not touch.
- Anything worth pushing back on: wrong-looking assumptions, hidden coupling, risky migrations, silent behaviour changes.

WHAT THE REVIEWER DOES NOT CARE ABOUT
- Code style, naming, formatting, import order, lint-level nits. Linting and a style guide already cover those. Never raise them.

HARD RULES
- Never write, create, delete, or modify anything inside ${worktree} or anywhere else outside your working directory. It is a shared git worktree that Cockpit re-checks-out on every head change; a single stray file breaks it. Read-only, always.
- Never commit, push, comment on the PR, review it, approve it, close it, or merge it. You have no reason to touch GitHub state at all.
- Do not write \`transcript.md\` or \`meta.json\` - Cockpit owns both.${notes ? `

ABOUT THIS REPOSITORY (from the team; use its vocabulary, and treat it as context rather than a checklist)
${notes}` : ""}`;
}

// harnesses without a system-prompt flag get the same text folded into the message by harnessFlags
function continuationPreamble(): string {
  return "Same PR, same conversation. Your standing instructions still hold.";
}

// the harnesses all stream one JSON event per line; the final "result" turn is the answer the reviewer sees
function answerFromTurns(turns: AgentTurn[]): string {
  const result = turns.filter((turn) => turn.kind === "result" && !turn.isError).at(-1);
  if (result?.text?.trim()) return result.text.trim();
  const text = turns.filter((turn) => turn.kind === "text" && turn.text?.trim()).at(-1);
  return text?.text?.trim() ?? "";
}

async function turnsFromLog(logPath: string): Promise<AgentTurn[]> {
  const file = Bun.file(logPath);
  if (!(await file.exists())) return [];
  const lines = (await file.text()).split("\n").filter((line) => line.trim() !== "");
  return turnsFromLines(lines);
}

function htmlTouchedSince(dir: string, sinceMs: number): boolean {
  try {
    return statSync(`${dir}/${REVIEW_HTML}`).mtimeMs >= sinceMs;
  } catch {
    return false;
  }
}

async function runOne(repo: string, number: number, message: string): Promise<void> {
  const key = prKeyOf(repo, number);
  const dir = reviewDir(repo, number);
  const headSha = currentPrHead(repo, number);
  const { baseRef, headRef } = prRefs(repo, number);

  // the worktree is the whole point of the feature - materialize it at the current head before asking
  let worktree = prWorktreeDir(repo, number);
  if (headSha) worktree = await materializePrWorktree(repo, number, headSha);
  else if (!existsSync(worktree)) throw new Error(`no known PR head commit for ${repo}#${number}`);

  const meta = await readReviewMeta(repo, number);
  // only a run that actually completed leaves a resumable session behind, so a failed first ask
  // does not strand every later message on a --continue that has nothing to continue
  const useContinue = meta.sessionStarted === true;
  const { model, effort } = reviewConfig();
  const startedAt = new Date().toISOString();
  const logPath = reviewLogPath(repo, number, startedAt);
  active.set(key, { startedAt, logPath, message });
  await appendReviewTurnOnce(repo, number, "user", message);

  const system = reviewSystemPrompt(repo, number, baseRef, headRef, worktree);
  const prompt = useContinue ? `${continuationPreamble()}\n\n${message}` : message;
  const logFd = openSync(logPath, "a");
  // strip inherited API keys so the agent authenticates via the harness's own login
  const { ANTHROPIC_API_KEY: _anthropicKey, OPENAI_API_KEY: _openaiKey, CODEX_API_KEY: _codexKey, ...env } = process.env;
  const args = harnessArgs(prompt, model, useContinue, undefined, {
    addDirs: [worktree],
    effort,
    appendSystemPrompt: system,
  });
  const startedMs = Date.now();
  const proc = Bun.spawn(args, { cwd: dir, env, stdout: logFd, stderr: logFd, stdin: "ignore" });
  const exitCode = await proc.exited;
  closeSync(logFd);

  const answer = answerFromTurns(await turnsFromLog(logPath));
  const failed = exitCode !== 0 && answer === "";
  const text = failed
    ? `The review agent exited with code ${exitCode} and produced no answer. Its log is at ${logPath}.`
    : answer || "(no answer)";
  await appendReviewTurn(repo, number, "agent", text);

  const htmlWritten = htmlTouchedSince(dir, startedMs);
  await writeReviewMeta(repo, number, {
    headSha,
    model,
    effort,
    sessionStarted: meta.sessionStarted === true || exitCode === 0,
    ...(htmlWritten ? { htmlHeadSha: headSha, htmlUpdatedAt: new Date().toISOString() } : {}),
  });
}

async function drain(repo: string, number: number): Promise<void> {
  const key = prKeyOf(repo, number);
  if (draining.has(key)) return;
  draining.add(key);
  try {
    for (;;) {
      const meta = await readReviewMeta(repo, number);
      const next = meta.pending[0];
      if (next === undefined) return;
      try {
        await runOne(repo, number, next);
      } catch (err) {
        // a failed message must not wedge the queue - record it and move on to the next
        await appendReviewTurn(repo, number, "agent", `The review agent could not run: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        active.delete(key);
        const after = await readReviewMeta(repo, number);
        await writeReviewMeta(repo, number, { pending: after.pending.slice(1) });
      }
    }
  } finally {
    draining.delete(key);
    active.delete(key);
  }
}

// Returns as soon as the message is durably queued. The answer lands in transcript.md whenever the
// agent finishes, so a closed tab, a navigation, or a server restart never loses it.
export async function enqueueReview(repo: string, number: number, message: string): Promise<number> {
  const meta = await readReviewMeta(repo, number);
  const pending = [...meta.pending, message];
  await writeReviewMeta(repo, number, { pending });
  void drain(repo, number).catch((err) => console.error(`review queue crashed for ${repo}#${number}:`, err));
  return pending.length;
}

export async function reviewActivity(repo: string, number: number): Promise<ReviewActivity> {
  const key = prKeyOf(repo, number);
  const run = active.get(key);
  const meta = await readReviewMeta(repo, number);
  return {
    running: run !== undefined,
    startedAt: run?.startedAt ?? null,
    currentMessage: run?.message ?? null,
    // the head of pending is whatever is running (or about to), so the queue behind it is the rest
    queued: run ? meta.pending.slice(1) : meta.pending,
    turns: run ? await turnsFromLog(run.logPath) : [],
  };
}

// A restart drops the in-memory drain loops, but the queue is in meta.json - pick every one back up
// rather than leaving a reviewer's question answered by nobody.
export function startReviewQueues(): void {
  for (const { repo, number } of listReviewPrs()) {
    void (async () => {
      const meta = await readReviewMeta(repo, number);
      if (meta.pending.length > 0) await drain(repo, number);
    })().catch((err) => console.error(`review queue resume failed for ${repo}#${number}:`, err));
  }
}
