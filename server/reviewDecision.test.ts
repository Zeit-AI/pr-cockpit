import { describe, expect, test } from "bun:test";
import { effectiveReviewDecision } from "./reviewDecision.ts";

const review = (login: string | null, state: string) => ({ author: login ? { login } : null, state });

describe("effectiveReviewDecision", () => {
  test("GitHub's own decision always wins when it has one", () => {
    expect(effectiveReviewDecision("CHANGES_REQUESTED", [review("bob", "APPROVED")], "me")).toBe("CHANGES_REQUESTED");
    expect(effectiveReviewDecision("REVIEW_REQUIRED", [], "me")).toBe("REVIEW_REQUIRED");
  });

  // the live case: a repo without branch protection, approved, reported as null
  test("an approval is found when the repo does not require review", () => {
    const reviews = [review("georg", "COMMENTED"), review("me", "COMMENTED"), review("georg", "APPROVED")];
    expect(effectiveReviewDecision(null, reviews, "me")).toBe("APPROVED");
  });

  test("comments alone decide nothing", () => {
    expect(effectiveReviewDecision(null, [review("georg", "COMMENTED")], "me")).toBe(null);
  });

  test("a request for changes outranks another reviewer's approval", () => {
    const reviews = [review("georg", "APPROVED"), review("ana", "CHANGES_REQUESTED")];
    expect(effectiveReviewDecision(null, reviews, "me")).toBe("CHANGES_REQUESTED");
  });

  test("a reviewer's later approval clears their own earlier request for changes", () => {
    const reviews = [review("georg", "CHANGES_REQUESTED"), review("georg", "APPROVED")];
    expect(effectiveReviewDecision(null, reviews, "me")).toBe("APPROVED");
  });

  test("a later request for changes overrides that reviewer's earlier approval", () => {
    const reviews = [review("georg", "APPROVED"), review("georg", "CHANGES_REQUESTED")];
    expect(effectiveReviewDecision(null, reviews, "me")).toBe("CHANGES_REQUESTED");
  });

  test("self-approval does not approve your own PR", () => {
    expect(effectiveReviewDecision(null, [review("me", "APPROVED")], "me")).toBe(null);
  });

  test("a review with no author is skipped rather than throwing", () => {
    expect(effectiveReviewDecision(null, [review(null, "APPROVED")], "me")).toBe(null);
  });

  test("no reviews at all stays undecided", () => {
    expect(effectiveReviewDecision(null, [], "me")).toBe(null);
  });
});
