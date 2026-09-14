import {
  deletePendingComment,
  getPendingComment,
  isStagedMode,
  listPendingComments,
  setStagedMode,
  updatePendingComment,
} from "./pendingReview.ts";

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
      submitting: row.submitted_mutation_id !== null,
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
