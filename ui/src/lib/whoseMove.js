const CI_FAIL = new Set(["FAILURE", "ERROR"]);

// A review "event" in GitHub's sense. Individual inline comments are not one of these, which is the
// whole point: a reviewer who has written notes but not submitted them is still on the hook.
const SUBMITTED_REVIEW = new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"]);

// Mergeability states GitHub will actually let you merge from. Listed positively rather than
// excluding the bad ones so that UNKNOWN - what GitHub returns until something forces it to compute
// mergeability - and an absent field both fail closed instead of falling into "ready to merge".
const MERGEABLE_NOW = new Set(["CLEAN", "UNSTABLE", "HAS_HOOKS", "BEHIND"]);

export function classify(pr, viewerLogin) {
  if (pr.state === "MERGED") return { group: "waiting", tone: "merged", label: "merged" };
  if (pr.state === "CLOSED") return { group: "waiting", tone: "closed", label: "closed" };
  const base = baseClassify(pr, viewerLogin);
  if (pr.fixerAgentExitReason === "green") return { group: base.group, tone: "ready", label: "auto-fix green" };
  if (pr.autoMergeEnabled) {
    if (pr.fixerAgentState === "died") return { group: base.group, tone: "fail", label: "agent died" };
    return { group: base.group, tone: "ready", label: "auto merging" };
  }
  return base;
}

// Pure over GitHub's own fields, and deliberately so: no local state is consulted. An unsubmitted
// review means GitHub still lists the viewer among the requested reviewers, so "have I reviewed this
// yet" is already answerable from the API - provided nothing publishes a review behind the reviewer's
// back, which is why staged comments never touch POST /pulls/{n}/comments.
function baseClassify(pr, viewerLogin) {
  const isAuthor = pr.viewerIsAuthor === true || (viewerLogin != null && pr.author === viewerLogin);
  const approved = pr.reviewDecision === "APPROVED";
  const canMergeNow = pr.mergeable === "MERGEABLE" && MERGEABLE_NOW.has(pr.mergeStateStatus) && !pr.isDraft;
  const submittedReview = SUBMITTED_REVIEW.has(pr.viewerReviewState);

  // Ready to merge: mine, approved, and I can press the button. Someone else's green PR is not my
  // move and not my merge - it belongs in Waiting until they ask me for something.
  if (isAuthor && approved && canMergeNow) {
    return { group: "ready", tone: "ready", label: pr.mergeStateStatus === "BEHIND" ? "ready · behind" : "ready" };
  }

  // Your move, reviewer side. viewerReviewRequested covers a request to the viewer directly and, in
  // this fork, a request to the reviewers team the viewer belongs to - GitHub's own inbox makes the
  // same union of review-requested:@me and team-review-requested:<org>/<team>.
  if (!isAuthor && pr.viewerReviewRequested === true && !submittedReview) {
    return { group: "yours", tone: "review", label: "your review" };
  }

  // Your move, author side: feedback landed and it is not an approval.
  if (isAuthor && !approved) {
    if (pr.reviewDecision === "CHANGES_REQUESTED") return { group: "yours", tone: "review", label: "changes requested" };
    if (pr.unresolvedCount > 0 && !pr.isDraft) {
      return { group: "yours", tone: "review", label: `${pr.unresolvedCount} thread${pr.unresolvedCount > 1 ? "s" : ""}` };
    }
  }

  // Still mine to act on, whatever the review state: nobody else can fix my red build or my conflict.
  if (isAuthor && !pr.isDraft) {
    if (CI_FAIL.has(pr.ciStatus)) return { group: "yours", tone: "fail", label: "failing" };
    if (pr.mergeable === "CONFLICTING") return { group: "yours", tone: "fail", label: "conflicts" };
  }

  if (pr.isDraft) return { group: "waiting", tone: "wait", label: "draft" };
  if (!isAuthor && CI_FAIL.has(pr.ciStatus)) return { group: "waiting", tone: "wait", label: "failing" };
  if (pr.ciStatus === "PENDING") return { group: "waiting", tone: "wait", label: "checks running" };
  if (isAuthor && approved) return { group: "waiting", tone: "wait", label: "approved" };
  if (isAuthor) return { group: "waiting", tone: "wait", label: "waiting on review" };
  if (submittedReview) return { group: "waiting", tone: "wait", label: "reviewed" };
  return { group: "waiting", tone: "wait", label: "in review" };
}

export const GROUP_ORDER = ["ready", "yours", "waiting"];

export const GROUP_TITLES = {
  ready: "Ready to merge",
  yours: "Your move",
  waiting: "Waiting",
};
