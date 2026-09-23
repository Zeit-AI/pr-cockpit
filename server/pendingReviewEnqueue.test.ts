import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same shape as mergeMethod.test.ts: mutations.ts pulls in db.ts, the poller and the agent
// supervisor at module load, so the whole scenario runs in one child with an isolated data dir.
test("inline comments stage instead of publishing, and a verdict carries them", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "pr-cockpit-pending-enqueue-"));
  const url = (name: string) => JSON.stringify(new URL(`./${name}`, import.meta.url).href);
  const scenario = `
    const { db } = await import(${url("db.ts")});
    const { enqueueMutation, discardMutation } = await import(${url("mutations.ts")});
    const { isStagedMode, setStagedMode, listPendingComments, pendingCount } = await import(${url("pendingReview.ts")});
    const REPO = "acme/repo";
    const out = {};
    const mutationRows = (kind) => db.query("SELECT payload_json FROM mutations WHERE kind = ?").all(kind);

    // default: an inline comment never reaches the queue, so nothing can publish it early
    enqueueMutation({ repo: REPO, number: 1, payload: { kind: "inline-comment", path: "a.ts", line: 3, side: "RIGHT", body: "staged" } });
    out.stagedByDefault = pendingCount(REPO, 1);
    out.queuedByDefault = mutationRows("inline-comment").length;

    // the per-PR escape hatch puts it back on the immediate path
    setStagedMode(REPO, 2, false);
    enqueueMutation({ repo: REPO, number: 2, payload: { kind: "inline-comment", path: "b.ts", line: 4, side: "RIGHT", body: "now" } });
    out.immediateStaged = pendingCount(REPO, 2);
    out.immediateQueued = mutationRows("inline-comment").length;

    // submitting a verdict snapshots the staged comments into the queued review
    enqueueMutation({ repo: REPO, number: 1, payload: { kind: "inline-comment", path: "a.ts", line: 9, side: "RIGHT", startLine: 7, body: "range" } });
    const verdictId = enqueueMutation({ repo: REPO, number: 1, payload: { kind: "review-verdict", event: "COMMENT", body: "summary" } });
    const verdict = JSON.parse(db.query("SELECT payload_json FROM mutations WHERE id = ?").get(verdictId).payload_json);
    out.verdictComments = verdict.comments;
    out.stillStagedWhileInFlight = pendingCount(REPO, 1);
    out.claimed = listPendingComments(REPO, 1).every((row) => row.submitted_mutation_id === verdictId);

    // discarding the submit gives the review back rather than losing hand-written comments
    discardMutation(verdictId);
    out.afterDiscardCount = pendingCount(REPO, 1);
    out.afterDiscardReleased = listPendingComments(REPO, 1).every((row) => row.submitted_mutation_id === null);

    // resubmitting after a failed submit supersedes it: no stale duplicate, and its summary survives
    const failedId = enqueueMutation({ repo: REPO, number: 1, payload: { kind: "review-verdict", event: "REQUEST_CHANGES", body: "first summary" } });
    db.query("UPDATE mutations SET state = 'failed' WHERE id = ?").run(failedId);
    const resubmitId = enqueueMutation({ repo: REPO, number: 1, payload: { kind: "review-verdict", event: "COMMENT", body: "" } });
    const resubmit = JSON.parse(db.query("SELECT payload_json FROM mutations WHERE id = ?").get(resubmitId).payload_json);
    out.supersededGone = db.query("SELECT id FROM mutations WHERE id = ?").get(failedId) === null;
    out.resubmitBody = resubmit.body;
    out.resubmitCommentCount = resubmit.comments.length;
    out.resubmitClaimed = listPendingComments(REPO, 1).every((row) => row.submitted_mutation_id === resubmitId);

    // a PR with nothing staged submits a bare verdict, with no comments key invented
    const bareId = enqueueMutation({ repo: REPO, number: 5, payload: { kind: "review-verdict", event: "APPROVE", body: "" } });
    out.bareVerdict = JSON.parse(db.query("SELECT payload_json FROM mutations WHERE id = ?").get(bareId).payload_json).comments ?? null;

    console.log(JSON.stringify(out));
    // exit rather than close: the mutation worker is already draining the queue in the background and
    // would fault on a closed database. Nothing here needs it to finish - the rows are the assertion.
    process.exit(0);
  `;

  try {
    const child = Bun.spawn([Bun.which("bun") ?? "bun", "-e", scenario], {
      env: { ...Bun.env, COCKPIT_DATA_DIR: dataDir, COCKPIT_UPDATE_DISABLED: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) throw new Error(stderr);
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);

    // the whole point: POST /pulls/{n}/comments is never reached for a staged PR
    expect(result.stagedByDefault).toBe(1);
    expect(result.queuedByDefault).toBe(0);
    expect(result.immediateStaged).toBe(0);
    expect(result.immediateQueued).toBe(1);

    expect(result.verdictComments).toEqual([
      { path: "a.ts", line: 3, side: "RIGHT", body: "staged" },
      { path: "a.ts", line: 9, side: "RIGHT", startLine: 7, startSide: "RIGHT", body: "range" },
    ]);
    expect(result.stillStagedWhileInFlight).toBe(2);
    expect(result.claimed).toBe(true);

    expect(result.afterDiscardCount).toBe(2);
    expect(result.supersededGone).toBe(true);
    expect(result.resubmitBody).toBe("first summary");
    expect(result.resubmitCommentCount).toBe(2);
    expect(result.resubmitClaimed).toBe(true);
    expect(result.afterDiscardReleased).toBe(true);

    expect(result.bareVerdict).toBe(null);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
