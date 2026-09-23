import {
  deletePendingComment,
  getPendingComment,
  isStagedMode,
  listPendingComments,
  owningMutationState,
  setStagedMode,
  updatePendingComment,
  type PendingReviewCommentRow,
} from "./pendingReview.ts";

// Staged comments ride the mutations list so the diff renders them exactly where they were written.
// DiffView already anchors pending inline-comment mutations to their line; a staged comment is the
// same thing at an earlier stage, and giving it the same shape means the diff needs no new wiring.
//
// The id is namespaced because these are rows in a different table: an unprefixed integer would let a
// discard aimed at a staged comment delete whatever mutation happens to share that number.
export const STAGED_ID_PREFIX = "staged:";

export function stagedCommentId(id: number): string {
  return `${STAGED_ID_PREFIX}${id}`;
}

export function parseStagedId(id: string): number | null {
  if (!id.startsWith(STAGED_ID_PREFIX)) return null;
  const parsed = Number(id.slice(STAGED_ID_PREFIX.length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// Shaped like serializeMutation so the UI cannot tell the two apart where it should not care. State
// tracks the review the comment is riding in: "staged" while it is still editable, "pending" once it
// is inside a submitted review, and "submit-failed" when that review did not go through. The last one
// is deliberately not actionable here - the verdict owns the retry, and a comment is never resent on
// its own, so offering Retry or Discard on the comment would be offering two buttons that refuse.
function stagedState(row: PendingReviewCommentRow): string {
  const owner = owningMutationState(row);
  if (owner === null) return "staged";
  return owner === "failed" ? "submit-failed" : "pending";
}

export function serializeStagedComment(row: PendingReviewCommentRow) {
  return {
    id: stagedCommentId(row.id),
    repo: row.repo,
    number: row.number,
    kind: "inline-comment",
    payload: {
      kind: "inline-comment",
      path: row.path,
      line: row.line,
      side: row.side,
      ...(row.start_line === null ? {} : { startLine: row.start_line, startSide: row.start_side ?? row.side }),
      body: row.body,
    },
    state: stagedState(row),
    error: null,
    createdAt: row.created_at,
  };
}

export function stagedCommentsForPr(repo: string, number: number) {
  return listPendingComments(repo, number).map(serializeStagedComment);
}

// "/pending-review/owner/repo/123/rest..." and its "/api"-prefixed twin, matching the review tab's
// route shape so the Vite dev proxy forwards both spellings without another rule.
function pendingRoute(parts: string[]): { repo: string; number: number; rest: string } | null {
  const at = parts[0] === "api" && parts[1] === "pending-review" ? 2 : parts[0] === "pending-review" ? 1 : -1;
  if (at < 0 || parts.length < at + 3) return null;
  const owner = parts[at]!;
  const name = parts[at + 1]!;
  const number = Number(parts[at + 2]);
  if (!Number.isInteger(number) || number <= 0) return null;
  return { repo: `${owner}/${name}`, number, rest: parts.slice(at + 3).join("/") };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function state(repo: string, number: number): Response {
  return json({
    staged: isStagedMode(repo, number),
    comments: listPendingComments(repo, number).map((row) => ({
      id: row.id,
      path: row.path,
      line: row.line,
      side: row.side,
      startLine: row.start_line,
      startSide: row.start_side,
      body: row.body,
      createdAt: row.created_at,
      // an in-flight comment is already inside a queued review and can no longer be edited or dropped
      submitting: row.submitted_mutation_id !== null && owningMutationState(row) !== "failed",
      // a failed submit keeps its comments; submitting the review again sends them in the new one
      failed: owningMutationState(row) === "failed",
    })),
  });
}

export async function handlePendingReviewRoute(parts: string[], req: Request): Promise<Response | null> {
  const route = pendingRoute(parts);
  if (!route) return null;
  const { repo, number, rest } = route;

  if (req.method === "GET" && rest === "") return state(repo, number);

  if (req.method === "PUT" && rest === "mode") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
    const staged = body && typeof body === "object" && "staged" in body ? body.staged : null;
    if (typeof staged !== "boolean") return json({ error: "staged must be a boolean" }, 400);
    setStagedMode(repo, number, staged);
    return state(repo, number);
  }

  const commentId = rest.startsWith("comment/") ? Number(rest.slice("comment/".length)) : NaN;
  if (Number.isInteger(commentId) && commentId > 0) {
    const row = getPendingComment(commentId);
    // scoped to the PR in the path so a stale tab cannot reach another PR's draft by id alone
    if (!row || row.repo !== repo || row.number !== number) return json({ error: "no such staged comment" }, 404);
    if (req.method === "DELETE") {
      if (!deletePendingComment(commentId)) return json({ error: "comment is already being submitted" }, 409);
      return state(repo, number);
    }
    if (req.method === "PUT") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      const text = body && typeof body === "object" && "body" in body ? body.body : null;
      if (typeof text !== "string" || text.trim() === "") return json({ error: "body is required" }, 400);
      if (!updatePendingComment(commentId, text)) return json({ error: "comment is already being submitted" }, 409);
      return state(repo, number);
    }
  }

  return null;
}
