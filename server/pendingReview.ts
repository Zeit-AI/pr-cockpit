import { db, getSetting, setSetting } from "./db.ts";

// Staged review comments. GitHub's POST /pulls/{n}/comments publishes immediately as a one-comment
// review with state COMMENTED: it notifies everyone per comment and drops the viewer from the
// requested reviewers, which is what silently moved a PR out of "Your move" halfway through reading
// it. Comments are held here instead and go out together through POST /pulls/{n}/reviews.
//
// Kept in its own table rather than reusing `mutations`: a queued mutation is a call already decided
// on and the worker drains it on sight, while a staged comment is a draft the reviewer is still
// editing. The queue only learns about these when a verdict is submitted, at which point they are
// snapshotted into the mutation payload - that snapshot is what makes an offline submit durable.
db.exec(`
CREATE TABLE IF NOT EXISTS pending_review_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  path TEXT NOT NULL,
  line INTEGER NOT NULL,
  side TEXT NOT NULL,
  start_line INTEGER,
  start_side TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  submitted_mutation_id INTEGER
);
CREATE INDEX IF NOT EXISTS pending_review_comments_pr_idx ON pending_review_comments (repo, number, id);
`);

export interface PendingReviewCommentRow {
  id: number;
  repo: string;
  number: number;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  start_line: number | null;
  start_side: "LEFT" | "RIGHT" | null;
  body: string;
  created_at: string;
  submitted_mutation_id: number | null;
}

export interface PendingReviewComment {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
  body: string;
}

// Staging is the default: the whole point of the feature is that a review does not leak out one
// comment at a time. The per-PR escape hatch exists for the case where a single remark is genuinely
// meant to go now - replying in an existing thread already bypasses this entirely.
function modeKey(repo: string, number: number): string {
  return `pending_review_mode:${repo}#${number}`;
}

export function isStagedMode(repo: string, number: number): boolean {
  return getSetting(modeKey(repo, number)) !== "immediate";
}

export function setStagedMode(repo: string, number: number, staged: boolean): void {
  setSetting(modeKey(repo, number), staged ? "staged" : "immediate");
}

export function stageComment(repo: string, number: number, comment: PendingReviewComment): number {
  const result = db.query(
    `INSERT INTO pending_review_comments (repo, number, path, line, side, start_line, start_side, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    repo,
    number,
    comment.path,
    comment.line,
    comment.side,
    comment.startLine ?? null,
    comment.startLine === undefined ? null : comment.startSide ?? comment.side,
    comment.body,
    new Date().toISOString(),
  );
  return Number(result.lastInsertRowid);
}

export function listPendingComments(repo: string, number: number): PendingReviewCommentRow[] {
  return db.query("SELECT * FROM pending_review_comments WHERE repo = ? AND number = ? ORDER BY id")
    .all(repo, number) as PendingReviewCommentRow[];
}

export function getPendingComment(id: number): PendingReviewCommentRow | null {
  return db.query("SELECT * FROM pending_review_comments WHERE id = ?").get(id) as PendingReviewCommentRow | null;
}

export function updatePendingComment(id: number, body: string): boolean {
  // An in-flight comment is owned by its mutation payload; editing it here would not change what ships.
  const result = db.query("UPDATE pending_review_comments SET body = ? WHERE id = ? AND submitted_mutation_id IS NULL").run(body, id);
  return result.changes > 0;
}

export function deletePendingComment(id: number): boolean {
  const result = db.query("DELETE FROM pending_review_comments WHERE id = ? AND submitted_mutation_id IS NULL").run(id);
  return result.changes > 0;
}

export function pendingCount(repo: string, number: number): number {
  const row = db.query("SELECT COUNT(*) AS n FROM pending_review_comments WHERE repo = ? AND number = ?")
    .get(repo, number) as { n: number };
  return row.n;
}

// One query for the whole inbox: the list renders a badge per row and must not go per-PR to get it.
export function pendingCountsByPr(): Map<string, number> {
  const rows = db.query("SELECT repo, number, COUNT(*) AS n FROM pending_review_comments GROUP BY repo, number")
    .all() as Array<{ repo: string; number: number; n: number }>;
  return new Map(rows.map((row) => [`${row.repo}#${row.number}`, row.n]));
}

// The state of the review a claimed comment is riding in. Null when the comment is still editable,
// or when the owning mutation is gone - a discarded submit releases the claim, so that cannot linger.
export function owningMutationState(row: PendingReviewCommentRow): string | null {
  if (row.submitted_mutation_id === null) return null;
  const owner = db.query("SELECT state FROM mutations WHERE id = ?").get(row.submitted_mutation_id) as { state: string } | null;
  return owner?.state ?? null;
}

export function toComment(row: PendingReviewCommentRow): PendingReviewComment {
  return {
    path: row.path,
    line: row.line,
    side: row.side,
    ...(row.start_line === null ? {} : { startLine: row.start_line, startSide: row.start_side ?? row.side }),
    body: row.body,
  };
}

// Claim/release/clear are the submit lifecycle. The rows outlive the enqueue on purpose: if the
// submit fails and the user discards it, the review is still sitting there rather than lost to a
// queue entry they just threw away.
export function claimForSubmit(repo: string, number: number, mutationId: number): PendingReviewComment[] {
  const rows = listPendingComments(repo, number);
  db.query("UPDATE pending_review_comments SET submitted_mutation_id = ? WHERE repo = ? AND number = ?")
    .run(mutationId, repo, number);
  return rows.map(toComment);
}

// Writes the claimed comments into the queued review so the mutation is self-contained: the worker
// may not run until the machine is back online, and by then staging may have moved on.
export function snapshotCommentsIntoMutation(repo: string, number: number, mutationId: number, payload: object): void {
  const comments = claimForSubmit(repo, number, mutationId);
  if (comments.length === 0) return;
  db.query("UPDATE mutations SET payload_json = ? WHERE id = ?").run(JSON.stringify({ ...payload, comments }), mutationId);
}

export function releaseClaim(mutationId: number): void {
  db.query("UPDATE pending_review_comments SET submitted_mutation_id = NULL WHERE submitted_mutation_id = ?").run(mutationId);
}

export function clearSubmitted(mutationId: number): void {
  db.query("DELETE FROM pending_review_comments WHERE submitted_mutation_id = ?").run(mutationId);
}
