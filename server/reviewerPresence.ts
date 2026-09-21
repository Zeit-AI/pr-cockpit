// Has anyone actually been put on the hook for reviewing this PR?
//
// GitHub drops a reviewer from `reviewRequests` the moment they submit, so "nobody is requested" on
// its own also describes a PR that has already been reviewed. The submitted reviews are the other
// half of the answer. Bots do not count: Greptile reviewing on push is not the author asking a
// human for a look, and the author reviewing their own PR is not either.
interface ReviewerPresenceDetail {
  reviewRequests?: { nodes?: Array<{ requestedReviewer?: { __typename?: string; login?: string } | null } | null> } | null;
  reviews?: { nodes?: Array<{ author?: { __typename?: string; login?: string } | null } | null> } | null;
}

function isBot(actor: { __typename?: string; login?: string } | null | undefined): boolean {
  return actor?.__typename === "Bot" || (actor?.login?.endsWith("[bot]") ?? false);
}

export function hasReviewer(detail: ReviewerPresenceDetail, authorLogin: string | null): boolean {
  const requested = detail.reviewRequests?.nodes ?? [];
  // A team request names no login, and is still a request: the whole team is on the hook.
  if (requested.some((request) => request?.requestedReviewer && !isBot(request.requestedReviewer))) return true;
  const reviews = detail.reviews?.nodes ?? [];
  return reviews.some((review) => review?.author && !isBot(review.author) && review.author.login !== authorLogin);
}
