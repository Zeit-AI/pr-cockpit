import { mkdirSync } from "node:fs";
import path from "node:path";

// Per-PR review companion storage. Deliberately a sibling of mirrors/worktrees/agents rather than a
// child of any of them: materializePrWorktree() refuses to re-checkout a worktree with stray files,
// and cleanupAgentWorkdir()/sweepOrphanedAgentWorkdirs() delete agent workdirs. Nothing sweeps this.
// read per call, not once at import: the data dir is process-wide configuration a test can point elsewhere
function reviewsRoot(): string {
  return `${Bun.env.COCKPIT_DATA_DIR ?? "data"}/reviews`;
}

// stream-json harness logs live outside the review dir so it holds only the three durable artifacts
function reviewLogsRoot(): string {
  return `${Bun.env.COCKPIT_DATA_DIR ?? "data"}/review-logs`;
}

export const REVIEW_HTML = "index.html";
export const REVIEW_TRANSCRIPT = "transcript.md";
export const REVIEW_META = "meta.json";

function reviewDirName(repo: string): string {
  return repo.replaceAll("/", "__");
}

// created on demand, never deleted - the transcript and the HTML are the point of the feature
export function reviewDir(repo: string, number: number): string {
  const dir = `${reviewsRoot()}/${reviewDirName(repo)}/pr-${number}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function reviewLogPath(repo: string, number: number, startedAt: string): string {
  const dir = `${reviewLogsRoot()}/${reviewDirName(repo)}`;
  mkdirSync(dir, { recursive: true });
  return `${dir}/pr-${number}-${startedAt.replace(/[:.]/g, "-")}.log`;
}

export interface ReviewMeta {
  // the PR head the agent last answered against, and the head index.html was last written at
  headSha: string | null;
  htmlHeadSha: string | null;
  htmlUpdatedAt: string | null;
  model: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  // set only after a harness run exits cleanly, so --continue is never used before a session exists
  sessionStarted: boolean;
}

const EMPTY_META: ReviewMeta = {
  headSha: null,
  htmlHeadSha: null,
  htmlUpdatedAt: null,
  model: null,
  createdAt: null,
  updatedAt: null,
  sessionStarted: false,
};

export async function readReviewMeta(repo: string, number: number): Promise<ReviewMeta> {
  const file = Bun.file(`${reviewDir(repo, number)}/${REVIEW_META}`);
  if (!(await file.exists())) return { ...EMPTY_META };
  try {
    return { ...EMPTY_META, ...(await file.json()) as Partial<ReviewMeta> };
  } catch {
    return { ...EMPTY_META };
  }
}

export async function writeReviewMeta(repo: string, number: number, patch: Partial<ReviewMeta>): Promise<ReviewMeta> {
  const current = await readReviewMeta(repo, number);
  const now = new Date().toISOString();
  const next: ReviewMeta = { ...current, ...patch, createdAt: current.createdAt ?? now, updatedAt: now };
  await Bun.write(`${reviewDir(repo, number)}/${REVIEW_META}`, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export type ReviewRole = "user" | "agent";
export interface ReviewTurn {
  role: ReviewRole;
  at: string;
  text: string;
}

// Invisible-in-markdown turn markers: transcript.md stays readable on its own, and the UI still gets
// an unambiguous split. The agent never writes this file - the server appends both sides of the chat.
const TURN_MARKER = /^<!-- turn:(user|agent) ([^\s>]+) -->$/;

export async function appendReviewTurn(repo: string, number: number, role: ReviewRole, text: string): Promise<void> {
  const path = `${reviewDir(repo, number)}/${REVIEW_TRANSCRIPT}`;
  const file = Bun.file(path);
  const existing = (await file.exists()) ? await file.text() : "";
  const heading = role === "user" ? "### Reviewer" : "### Review agent";
  const block = `<!-- turn:${role} ${new Date().toISOString()} -->\n${heading}\n\n${text.trim()}\n\n`;
  await Bun.write(path, existing + block);
}

export function parseTranscript(markdown: string): ReviewTurn[] {
  const turns: ReviewTurn[] = [];
  let current: ReviewTurn | null = null;
  for (const line of markdown.split("\n")) {
    const marker = TURN_MARKER.exec(line.trim());
    if (marker) {
      if (current) turns.push({ ...current, text: current.text.trim() });
      current = { role: marker[1] as ReviewRole, at: marker[2]!, text: "" };
      continue;
    }
    // the heading immediately under a marker is decoration for humans reading the raw file
    if (current && current.text === "" && /^### (Reviewer|Review agent)$/.test(line.trim())) continue;
    if (current) current.text += `${line}\n`;
  }
  if (current) turns.push({ ...current, text: current.text.trim() });
  return turns;
}

export async function readTranscript(repo: string, number: number): Promise<ReviewTurn[]> {
  const file = Bun.file(`${reviewDir(repo, number)}/${REVIEW_TRANSCRIPT}`);
  return (await file.exists()) ? parseTranscript(await file.text()) : [];
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function reviewContentType(relative: string): string {
  return CONTENT_TYPES[path.extname(relative).toLowerCase()] ?? "application/octet-stream";
}

// the served path comes straight off the URL: refuse absolute paths, traversal, and anything that
// resolves outside the PR's own review directory even after symlink-free normalization
export function resolveReviewFile(repo: string, number: number, relative: string): string | null {
  if (relative === "" || relative.startsWith("/")) return null;
  // percent-decode per segment, then validate: a decoded separator or traversal must not smuggle
  // itself past the split, and "%2e%2e%2f" is the same attack as "../"
  const segments: string[] = [];
  for (const raw of relative.split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === "" || segment === "." || segment === ".." || /[/\\\0]/.test(segment)) return null;
    segments.push(segment);
  }
  const root = reviewDir(repo, number);
  const resolved = path.resolve(root, segments.join("/"));
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}
