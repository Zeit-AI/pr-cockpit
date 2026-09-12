import { closeSync, existsSync, openSync, statSync } from "node:fs";
import { getCachedPrDetail, getPr } from "./db.ts";
import { prKeyOf } from "./prKey.ts";
import { agentModel } from "./settings.ts";
import { harnessArgs } from "./harness.ts";
import { materializePrWorktree, prWorktreeDir } from "./mirror.ts";
import { turnsFromLines } from "./agents.ts";
import {
  appendReviewTurn,
  readReviewMeta,
  reviewDir,
  reviewLogPath,
  REVIEW_HTML,
  writeReviewMeta,
} from "./reviews.ts";

// One review agent per PR at a time, the same guard the fixer/autofix/custom agents use. Deliberately
// NOT a fixer_agents or agent_runs row: finishRun() closes every running row for a (repo, number), so a
// review run sharing the table would corrupt a concurrently running fixer's bookkeeping.
const inFlight = new Map<string, Promise<string>>();

export function reviewAgentRunning(repo: string, number: number): boolean {
  return inFlight.has(prKeyOf(repo, number));
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

function systemPrompt(repo: string, number: number, baseRef: string, headRef: string, worktree: string): string {
  return `You are the review companion inside PR Cockpit for the pull request ${repo}#${number} (branch "${headRef}" into "${baseRef}"). You are talking to the reviewer, in an ongoing conversation that spans days.

WHAT YOU CAN SEE
- ${worktree} is a full checkout of the repository at this PR's head, granted to you as an added directory. Read and grep it freely. Most questions are about the code AROUND the change, not only the diff - when the reviewer asks about a symbol, a pattern, or a subsystem, go find it in the repository and answer from what is actually there.
- \`pr-cockpit ${repo}#${number}\` is the PR itself: plain for state, \`--diff\` for the unified diff, \`--file PATH\` for a file at the head, \`--logs\` for failed check logs, \`--jobs\` for Actions state.
- Your working directory is yours. \`index.html\`, \`transcript.md\` and \`meta.json\` live here.

WHAT YOU PRODUCE
- Short, sharp answers in chat. No preamble, no announcing what you are about to do, no restating the question, no closing summary. If the answer is two sentences, write two sentences.
- Anything structural, spatial, or relational goes into \`index.html\` in your working directory: call graphs, component trees, module maps, sequences, use-site tables, blast radius, quizzes. Short factual answers stay in chat and do not touch the HTML.
- When you change the HTML, say so in one short line rather than describing its contents back to the reviewer.

THE HTML
- Update and EXTEND \`index.html\` across the conversation. Read it first, add to it, keep every existing section unless the reviewer asks for it to go. Never regenerate it from scratch.
- Fully self-contained: all CSS and JS inline, no CDN links, no external fonts, no images fetched over the network, no runtime network calls of any kind. It must render completely with the machine offline, interactive parts included.
- Dark-first and quiet, matching Cockpit: near-black background, restrained type, minimal chrome, no framework look. It is a map, not a report.

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
- Do not write \`transcript.md\` or \`meta.json\` - Cockpit owns both.`;
}

function firstPrompt(repo: string, number: number, baseRef: string, headRef: string, worktree: string, message: string): string {
  return `${systemPrompt(repo, number, baseRef, headRef, worktree)}

REVIEWER:
${message}`;
}

function nextPrompt(worktree: string, message: string): string {
  return `Same PR, same conversation. The rules from the first message still hold: sharp answers in chat, structural work extends ${REVIEW_HTML} in this directory without discarding existing sections, self-contained HTML with no network use, and nothing at all is ever written into ${worktree}.

REVIEWER:
${message}`;
}

// the harnesses all stream one JSON event per line; the final "result" turn is the answer the reviewer sees
async function answerFromLog(logPath: string): Promise<string> {
  const file = Bun.file(logPath);
  if (!(await file.exists())) return "";
  const lines = (await file.text()).split("\n").filter((line) => line.trim() !== "");
  const turns = turnsFromLines(lines);
  const result = turns.filter((turn) => turn.kind === "result" && !turn.isError).at(-1);
  if (result?.text?.trim()) return result.text.trim();
  const text = turns.filter((turn) => turn.kind === "text" && turn.text?.trim()).at(-1);
  return text?.text?.trim() ?? "";
}

function htmlTouchedSince(dir: string, sinceMs: number): boolean {
  try {
    return statSync(`${dir}/${REVIEW_HTML}`).mtimeMs >= sinceMs;
  } catch {
    return false;
  }
}

async function runAsk(repo: string, number: number, message: string): Promise<string> {
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
  const model = agentModel("review");
  const startedAt = new Date().toISOString();
  const logPath = reviewLogPath(repo, number, startedAt);

  await appendReviewTurn(repo, number, "user", message);

  const prompt = useContinue ? nextPrompt(worktree, message) : firstPrompt(repo, number, baseRef, headRef, worktree, message);
  const logFd = openSync(logPath, "a");
  // strip inherited API keys so the agent authenticates via the harness's own login
  const { ANTHROPIC_API_KEY: _anthropicKey, OPENAI_API_KEY: _openaiKey, CODEX_API_KEY: _codexKey, ...env } = process.env;
  const args = harnessArgs(prompt, model, useContinue, undefined, [worktree]);
  const startedMs = Date.now();
  const proc = Bun.spawn(args, { cwd: dir, env, stdout: logFd, stderr: logFd, stdin: "ignore" });
  const exitCode = await proc.exited;
  closeSync(logFd);

  const answer = await answerFromLog(logPath);
  const failed = exitCode !== 0 && answer === "";
  const text = failed ? `The review agent exited with code ${exitCode} and produced no answer. Its log is at ${logPath}.` : answer;
  await appendReviewTurn(repo, number, "agent", text || "(no answer)");

  const htmlWritten = htmlTouchedSince(dir, startedMs);
  await writeReviewMeta(repo, number, {
    headSha,
    model,
    sessionStarted: meta.sessionStarted === true || exitCode === 0,
    ...(htmlWritten ? { htmlHeadSha: headSha, htmlUpdatedAt: new Date().toISOString() } : {}),
  });
  return text;
}

export function askReview(repo: string, number: number, message: string): Promise<string> {
  const key = prKeyOf(repo, number);
  if (inFlight.has(key)) throw new Error("a review agent is already answering for this PR - wait for it to finish");
  const promise = runAsk(repo, number, message).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
