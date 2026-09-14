// Our flow requests review from a team, not a person. GitHub's viewerReviewRequested only reflects a
// request naming the viewer, so a team-assigned PR would never reach "Your move" for anybody. The
// inbox models GitHub's own filter instead: awaiting my review OR my team's review, i.e. the union of
// review-requested:@me and team-review-requested:<org>/<team>.
//
// Hardcoded rather than configured: this fork exists for one organisation, and a setting nobody in
// that organisation would ever change is a control to maintain for no reader. Widen this list the day
// a second team reviews here.
const REVIEWER_TEAMS = ["Zeit-AI/reviewers"];

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Matched on slug because that is what survives a display-name change, and against the team name too
// because the REST detail path carries the name when no slug is present.
export function isViewerReviewerTeam(repo: string, team: { slug?: string; name?: string }): boolean {
  const owner = repo.split("/")[0]?.toLowerCase() ?? "";
  const candidates = [team.slug, team.name].filter((value): value is string => typeof value === "string" && value !== "");
  return REVIEWER_TEAMS.some((entry) => {
    const [teamOwner, teamSlug] = entry.split("/");
    if (!teamOwner || !teamSlug) return false;
    if (teamOwner.toLowerCase() !== owner) return false;
    return candidates.some((candidate) => slugify(candidate) === slugify(teamSlug));
  });
}

export function teamReviewRequested(
  repo: string,
  nodes: Array<{ requestedReviewer: { __typename?: string; login?: string; name?: string; slug?: string } | null }>,
): boolean {
  return nodes.some((request) => {
    const reviewer = request.requestedReviewer;
    return reviewer?.__typename === "Team" && isViewerReviewerTeam(repo, reviewer);
  });
}
