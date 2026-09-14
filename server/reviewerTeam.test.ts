import { describe, expect, test } from "bun:test";
import { isViewerReviewerTeam, teamReviewRequested } from "./reviewerTeam.ts";

describe("isViewerReviewerTeam", () => {
  test("matches the reviewers team by slug", () => {
    expect(isViewerReviewerTeam("Zeit-AI/pr-cockpit", { slug: "reviewers" })).toBe(true);
  });

  test("matches case-insensitively on the owner", () => {
    expect(isViewerReviewerTeam("zeit-ai/pr-cockpit", { slug: "Reviewers" })).toBe(true);
  });

  test("falls back to the display name when no slug is carried", () => {
    expect(isViewerReviewerTeam("Zeit-AI/pr-cockpit", { name: "Reviewers" })).toBe(true);
  });

  test("rejects another team in the same org", () => {
    expect(isViewerReviewerTeam("Zeit-AI/pr-cockpit", { slug: "designers" })).toBe(false);
  });

  test("rejects the same team name in another org", () => {
    expect(isViewerReviewerTeam("other-org/thing", { slug: "reviewers" })).toBe(false);
  });

  test("rejects an empty team", () => {
    expect(isViewerReviewerTeam("Zeit-AI/pr-cockpit", {})).toBe(false);
  });
});

describe("teamReviewRequested", () => {
  test("a request naming the reviewers team counts", () => {
    const nodes = [{ requestedReviewer: { __typename: "Team", slug: "reviewers", name: "Reviewers" } }];
    expect(teamReviewRequested("Zeit-AI/pr-cockpit", nodes)).toBe(true);
  });

  test("a request naming a person does not", () => {
    const nodes = [{ requestedReviewer: { __typename: "User", login: "reviewers" } }];
    expect(teamReviewRequested("Zeit-AI/pr-cockpit", nodes)).toBe(false);
  });

  test("no requests at all", () => {
    expect(teamReviewRequested("Zeit-AI/pr-cockpit", [])).toBe(false);
  });

  test("a null reviewer is skipped", () => {
    expect(teamReviewRequested("Zeit-AI/pr-cockpit", [{ requestedReviewer: null }])).toBe(false);
  });
});
