// GitHub returns `reviewDecision: null` when the repository does not *require* a review, so an
// approved PR in a repo with no branch protection is indistinguishable from an unreviewed one on that
// field alone. The approval is still there in the reviews, so read it from them.
//
// Without this, "approved" is never true in a repo that does not require reviews and nothing ever
// reaches Ready to merge.
export function effectiveReviewDecision(
  decision: string | null,
  reviews: Array<{ author: { login: string } | null; state: string }>,
  authorLogin: string | null,
): string | null {
  if (decision !== null) return decision;

  // Last decisive review per reviewer wins - an approval after a request for changes clears it, and
  // COMMENTED never decides anything. The author's own reviews do not count toward their PR.
  const latest = new Map<string, string>();
  for (const review of reviews) {
    const login = review.author?.login;
    if (!login || login === authorLogin) continue;
    if (review.state !== "APPROVED" && review.state !== "CHANGES_REQUESTED") continue;
    latest.set(login, review.state);
  }

  const states = [...latest.values()];
  if (states.includes("CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
  return states.includes("APPROVED") ? "APPROVED" : null;
}
