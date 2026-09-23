import type { PendingReviewComment } from "./pendingReview.ts";

// GitHub rejects a whole review with 422 "Line could not be resolved" when a single inline comment
// points outside the PR's current diff - typically because commits landed after the comment was
// staged, or a file was renamed away. One stale anchor then blocks every comment in the review, and
// every later submit that reclaims it. These helpers let the submit keep the anchors that still land
// and carry the rest in the review body, so written feedback is never held hostage by line numbers.

type Side = "LEFT" | "RIGHT";

// path -> side -> line -> hunk index. A range comment must start and end in the same hunk.
export type CommentableLines = Map<string, Record<Side, Map<number, number>>>;

export function commentableLines(patch: string): CommentableLines {
  const files: CommentableLines = new Map();
  let oldPath: string | null = null;
  let current: Record<Side, Map<number, number>> | null = null;
  let hunk = -1;
  let left = 0;
  let right = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      current = null;
      oldPath = null;
      continue;
    }
    if (raw.startsWith("--- ")) {
      oldPath = raw === "--- /dev/null" ? null : raw.replace(/^--- a\//, "");
      continue;
    }
    if (raw.startsWith("+++ ")) {
      // a deleted file is addressed by its old path
      const path = raw === "+++ /dev/null" ? oldPath : raw.replace(/^\+\+\+ b\//, "");
      current = path ? files.get(path) ?? { LEFT: new Map(), RIGHT: new Map() } : null;
      if (path && current) files.set(path, current);
      continue;
    }
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) {
      hunk += 1;
      left = Number(header[1]);
      right = Number(header[2]);
      continue;
    }
    if (!current || hunk < 0) continue;
    if (raw.startsWith("+")) current.RIGHT.set(right++, hunk);
    else if (raw.startsWith("-")) current.LEFT.set(left++, hunk);
    else if (raw.startsWith(" ")) {
      current.LEFT.set(left++, hunk);
      current.RIGHT.set(right++, hunk);
    }
  }
  return files;
}

export function isAnchorable(lines: CommentableLines, comment: PendingReviewComment): boolean {
  const file = lines.get(comment.path);
  if (!file) return false;
  const end = file[comment.side].get(comment.line);
  if (end === undefined) return false;
  if (comment.startLine === undefined) return true;
  return file[comment.startSide ?? comment.side].get(comment.startLine) === end;
}

function lineLabel(comment: PendingReviewComment): string {
  return comment.startLine !== undefined && comment.startLine !== comment.line
    ? `L${comment.startLine}-L${comment.line}`
    : `L${comment.line}`;
}

// Unanchored comments are appended below the reviewer's own summary, each labelled with where it
// was written so the author can still find the code it is about.
export function foldIntoBody(body: string, comments: PendingReviewComment[]): string {
  if (comments.length === 0) return body;
  const folded = comments.map((comment) => {
    const quoted = comment.body.split("\n").map((line) => `> ${line}`).join("\n");
    return `**\`${comment.path}\` ${lineLabel(comment)}**\n${quoted}`;
  });
  const note = "_These comments were written against an earlier revision and could no longer be placed on a line:_";
  return [body.trim(), note, ...folded].filter(Boolean).join("\n\n");
}

export function isUnresolvableAnchorError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("422") && /(Line|Path|Position) could not be resolved/.test(message);
}
