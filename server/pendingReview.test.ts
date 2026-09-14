import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

// The module opens the shared database at import time, so the scratch data dir has to be set before it.
process.env.COCKPIT_DATA_DIR = mkdtempSync(`${tmpdir()}/cockpit-pending-`);

const {
  claimForSubmit,
  clearSubmitted,
  deletePendingComment,
  isStagedMode,
  listPendingComments,
  pendingCount,
  pendingCountsByPr,
  releaseClaim,
  setStagedMode,
  stageComment,
  toComment,
  updatePendingComment,
} = await import("./pendingReview.ts");
const { db } = await import("./db.ts");

const REPO = "acme/repo";

beforeEach(() => {
  db.exec("DELETE FROM pending_review_comments");
});

describe("staging mode", () => {
  test("batching is the default, so nothing publishes by accident", () => {
    expect(isStagedMode(REPO, 1)).toBe(true);
  });

  test("the per-PR escape hatch round-trips", () => {
    setStagedMode(REPO, 2, false);
    expect(isStagedMode(REPO, 2)).toBe(false);
    expect(isStagedMode(REPO, 3)).toBe(true);
    setStagedMode(REPO, 2, true);
    expect(isStagedMode(REPO, 2)).toBe(true);
  });
});

describe("staged comments", () => {
  test("a single-line comment round-trips without range fields", () => {
    stageComment(REPO, 1, { path: "a.ts", line: 4, side: "RIGHT", body: "why" });
    expect(listPendingComments(REPO, 1).map(toComment)).toEqual([
      { path: "a.ts", line: 4, side: "RIGHT", body: "why" },
    ]);
  });

  test("a multi-line comment keeps its range and defaults the start side", () => {
    stageComment(REPO, 1, { path: "a.ts", line: 9, side: "RIGHT", startLine: 6, body: "range" });
    expect(listPendingComments(REPO, 1).map(toComment)).toEqual([
      { path: "a.ts", line: 9, side: "RIGHT", startLine: 6, startSide: "RIGHT", body: "range" },
    ]);
  });

  test("comments keep insertion order, which is the order the review reads in", () => {
    stageComment(REPO, 1, { path: "b.ts", line: 1, side: "RIGHT", body: "first" });
    stageComment(REPO, 1, { path: "a.ts", line: 1, side: "RIGHT", body: "second" });
    expect(listPendingComments(REPO, 1).map((row) => row.body)).toEqual(["first", "second"]);
  });

  test("counts are scoped per PR", () => {
    stageComment(REPO, 1, { path: "a.ts", line: 1, side: "RIGHT", body: "x" });
    stageComment(REPO, 2, { path: "a.ts", line: 1, side: "RIGHT", body: "y" });
    stageComment(REPO, 2, { path: "a.ts", line: 2, side: "RIGHT", body: "z" });
    expect(pendingCount(REPO, 1)).toBe(1);
    expect(pendingCount(REPO, 2)).toBe(2);
    expect(pendingCountsByPr().get(`${REPO}#2`)).toBe(2);
  });

  test("editing and discarding a draft", () => {
    const id = stageComment(REPO, 1, { path: "a.ts", line: 1, side: "RIGHT", body: "draft" });
    expect(updatePendingComment(id, "revised")).toBe(true);
    expect(listPendingComments(REPO, 1)[0]!.body).toBe("revised");
    expect(deletePendingComment(id)).toBe(true);
    expect(pendingCount(REPO, 1)).toBe(0);
  });
});

describe("submit lifecycle", () => {
  test("claiming snapshots the comments and freezes them against edits", () => {
    const id = stageComment(REPO, 1, { path: "a.ts", line: 1, side: "RIGHT", body: "keep" });
    const claimed = claimForSubmit(REPO, 1, 77);
    expect(claimed).toEqual([{ path: "a.ts", line: 1, side: "RIGHT", body: "keep" }]);
    // in-flight comments belong to the queued review, not to the composer
    expect(updatePendingComment(id, "too late")).toBe(false);
    expect(deletePendingComment(id)).toBe(false);
  });

  test("a discarded submit leaves the review staged rather than losing it", () => {
    stageComment(REPO, 1, { path: "a.ts", line: 1, side: "RIGHT", body: "hand written" });
    claimForSubmit(REPO, 1, 77);
    releaseClaim(77);
    expect(pendingCount(REPO, 1)).toBe(1);
    const row = listPendingComments(REPO, 1)[0]!;
    expect(row.submitted_mutation_id).toBe(null);
    expect(deletePendingComment(row.id)).toBe(true);
  });

  test("a successful submit clears only its own comments", () => {
    stageComment(REPO, 1, { path: "a.ts", line: 1, side: "RIGHT", body: "shipped" });
    claimForSubmit(REPO, 1, 77);
    stageComment(REPO, 1, { path: "a.ts", line: 2, side: "RIGHT", body: "written after submitting" });
    clearSubmitted(77);
    expect(listPendingComments(REPO, 1).map((row) => row.body)).toEqual(["written after submitting"]);
  });

  test("claiming an empty PR yields no comments, so the verdict ships alone", () => {
    expect(claimForSubmit(REPO, 9, 78)).toEqual([]);
  });
});
