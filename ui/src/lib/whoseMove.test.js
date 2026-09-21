import { describe, expect, test } from "bun:test";
import { classify } from "./whoseMove.js";

function pr(overrides) {
  return {
    state: "OPEN",
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    viewerReviewRequested: false,
    viewerReviewState: null,
    viewerIsAuthor: false,
    author: "someone-else",
    ciStatus: "SUCCESS",
    reviewDecision: null,
    unresolvedCount: 0,
    autoMergeEnabled: false,
    fixerAgentState: null,
    fixerAgentExitReason: null,
    ...overrides,
  };
}

// my PR, approved, nothing in the way
function mergeable(overrides) {
  return pr({ viewerIsAuthor: true, reviewDecision: "APPROVED", mergeStateStatus: "CLEAN", ...overrides });
}

describe("classify: agent overrides", () => {
  test("surfaces auto-fix green regardless of underlying status", () => {
    const result = classify(pr({ fixerAgentExitReason: "green", ciStatus: "PENDING" }), "viewer");
    expect(result.label).toBe("auto-fix green");
    expect(result.tone).toBe("ready");
  });

  test("auto-fix green takes priority over auto-merge armed", () => {
    const result = classify(pr({ fixerAgentExitReason: "green", autoMergeEnabled: true }), "viewer");
    expect(result.label).toBe("auto-fix green");
  });

  test("falls through to normal classification without a green exit", () => {
    const result = classify(pr({}), "viewer");
    expect(result.label).not.toBe("auto-fix green");
  });
});

describe("classify: ready to merge", () => {
  test("my approved mergeable PR is ready", () => {
    expect(classify(mergeable({}), "viewer")).toEqual({ group: "ready", tone: "ready", label: "ready" });
  });

  test("approval with unresolved threads is still ready", () => {
    expect(classify(mergeable({ unresolvedCount: 3 }), "viewer").group).toBe("ready");
  });

  test("behind base stays ready with a behind label", () => {
    const result = classify(mergeable({ mergeStateStatus: "BEHIND" }), "viewer");
    expect(result).toEqual({ group: "ready", tone: "ready", label: "ready · behind" });
  });

  test("someone else's green approved PR is not mine to merge", () => {
    const result = classify(mergeable({ viewerIsAuthor: false, author: "someone-else" }), "viewer");
    expect(result.group).not.toBe("ready");
  });

  test("author matched by login rather than the viewer flag is still ready", () => {
    const result = classify(mergeable({ viewerIsAuthor: false, author: "viewer" }), "viewer");
    expect(result.group).toBe("ready");
  });

  test("green CI without an approval is not ready", () => {
    const result = classify(pr({ viewerIsAuthor: true, mergeStateStatus: "CLEAN", reviewDecision: null }), "viewer");
    expect(result.group).not.toBe("ready");
  });

  test("approved but conflicting is not ready", () => {
    const result = classify(mergeable({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }), "viewer");
    expect(result.group).not.toBe("ready");
  });

  test("approved drafts are never ready", () => {
    expect(classify(mergeable({ isDraft: true }), "viewer").group).not.toBe("ready");
  });
});

describe("classify: fails closed on unknown fields", () => {
  test("unknown mergeability is not ready", () => {
    const result = classify(mergeable({ mergeStateStatus: "UNKNOWN", mergeable: "UNKNOWN" }), "viewer");
    expect(result.group).not.toBe("ready");
  });

  test("missing mergeability fields are not ready", () => {
    const result = classify(mergeable({ mergeStateStatus: undefined, mergeable: undefined }), "viewer");
    expect(result.group).not.toBe("ready");
  });

  test("missing review decision is not ready", () => {
    const result = classify(mergeable({ reviewDecision: undefined }), "viewer");
    expect(result.group).not.toBe("ready");
  });

  test("a list row carrying nothing but a number is not ready", () => {
    const result = classify({ state: "OPEN", number: 7 }, "viewer");
    expect(result.group).not.toBe("ready");
  });
});

describe("classify: your move as reviewer", () => {
  test("review requested of me and not yet submitted", () => {
    const result = classify(pr({ viewerReviewRequested: true }), "viewer");
    expect(result).toEqual({ group: "yours", tone: "review", label: "your review" });
  });

  test("a green PR does not swallow a requested review", () => {
    const result = classify(pr({ viewerReviewRequested: true, mergeStateStatus: "CLEAN", reviewDecision: "APPROVED" }), "viewer");
    expect(result.group).toBe("yours");
  });

  test("a submitted COMMENTED review clears my move", () => {
    const result = classify(pr({ viewerReviewRequested: true, viewerReviewState: "COMMENTED" }), "viewer");
    expect(result.group).toBe("waiting");
  });

  test("a submitted approval clears my move", () => {
    const result = classify(pr({ viewerReviewRequested: true, viewerReviewState: "APPROVED" }), "viewer");
    expect(result.group).toBe("waiting");
  });

  test("a submitted request for changes clears my move", () => {
    const result = classify(pr({ viewerReviewRequested: true, viewerReviewState: "CHANGES_REQUESTED" }), "viewer");
    expect(result.group).toBe("waiting");
  });

  test("an unsubmitted PENDING review does not count as submitted", () => {
    const result = classify(pr({ viewerReviewRequested: true, viewerReviewState: "PENDING" }), "viewer");
    expect(result.group).toBe("yours");
  });

  test("new commits after I submitted keep the PR in waiting", () => {
    const result = classify(pr({ viewerReviewRequested: true, viewerReviewState: "COMMENTED", ciStatus: "PENDING" }), "viewer");
    expect(result.group).toBe("waiting");
  });

  test("no review requested of me is not my move", () => {
    expect(classify(pr({}), "viewer").group).toBe("waiting");
  });
});

describe("classify: your move as author", () => {
  test("changes requested on my PR", () => {
    const result = classify(pr({ viewerIsAuthor: true, reviewDecision: "CHANGES_REQUESTED" }), "viewer");
    expect(result).toEqual({ group: "yours", tone: "review", label: "changes requested" });
  });

  test("unresolved threads on my unapproved PR", () => {
    const result = classify(pr({ viewerIsAuthor: true, unresolvedCount: 2 }), "viewer");
    expect(result).toEqual({ group: "yours", tone: "review", label: "2 threads" });
  });

  test("one unresolved thread is singular", () => {
    expect(classify(pr({ viewerIsAuthor: true, unresolvedCount: 1 }), "viewer").label).toBe("1 thread");
  });

  test("my failing PR is mine to fix", () => {
    const result = classify(pr({ viewerIsAuthor: true, ciStatus: "FAILURE" }), "viewer");
    expect(result).toEqual({ group: "yours", tone: "fail", label: "failing" });
  });

  test("my conflicting PR is mine to fix", () => {
    const result = classify(pr({ viewerIsAuthor: true, mergeable: "CONFLICTING" }), "viewer");
    expect(result).toEqual({ group: "yours", tone: "fail", label: "conflicts" });
  });

  test("my PR awaiting review with no feedback waits", () => {
    const result = classify(pr({ viewerIsAuthor: true, reviewDecision: "REVIEW_REQUIRED", hasReviewer: true }), "viewer");
    expect(result.group).toBe("waiting");
  });

  test("my open PR with nobody on the hook is mine to send out", () => {
    const result = classify(pr({ viewerIsAuthor: true, hasReviewer: false }), "viewer");
    expect(result).toEqual({ group: "yours", tone: "review", label: "no reviewer" });
  });

  test("a failing PR with no reviewer still reads as failing", () => {
    const result = classify(pr({ viewerIsAuthor: true, hasReviewer: false, ciStatus: "FAILURE" }), "viewer");
    expect(result.label).toBe("failing");
  });

  test("my draft with no reviewer keeps its draft lane", () => {
    const result = classify(pr({ viewerIsAuthor: true, hasReviewer: false, isDraft: true }), "viewer");
    expect(result).toEqual({ group: "waiting", tone: "wait", label: "draft" });
  });

  test("someone else's PR with no reviewer is not my move", () => {
    const result = classify(pr({ hasReviewer: false }), "viewer");
    expect(result.group).toBe("waiting");
  });

  test("an unknown reviewer field classifies the way it always did", () => {
    const result = classify(pr({ viewerIsAuthor: true }), "viewer");
    expect(result).toEqual({ group: "waiting", tone: "wait", label: "waiting on review" });
  });
});

describe("classify: waiting", () => {
  test("their PR where I already submitted", () => {
    const result = classify(pr({ viewerReviewState: "APPROVED" }), "viewer");
    expect(result.group).toBe("waiting");
  });

  test("drafts wait", () => {
    expect(classify(pr({ isDraft: true }), "viewer")).toEqual({ group: "waiting", tone: "wait", label: "draft" });
  });

  test("my draft waits rather than claiming my move", () => {
    const result = classify(pr({ viewerIsAuthor: true, isDraft: true, ciStatus: "FAILURE" }), "viewer");
    expect(result.group).toBe("waiting");
  });

  test("checks running wait", () => {
    const result = classify(pr({ ciStatus: "PENDING" }), "viewer");
    expect(result).toEqual({ group: "waiting", tone: "wait", label: "checks running" });
  });

  test("my approved PR that is not mergeable waits rather than claiming ready", () => {
    const result = classify(mergeable({ mergeStateStatus: "BLOCKED" }), "viewer");
    expect(result.group).toBe("waiting");
  });

  test("merged and closed PRs wait", () => {
    expect(classify(pr({ state: "MERGED" }), "viewer").label).toBe("merged");
    expect(classify(pr({ state: "CLOSED" }), "viewer").label).toBe("closed");
  });
});
