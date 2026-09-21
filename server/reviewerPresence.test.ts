import { describe, expect, test } from "bun:test";
import { hasReviewer } from "./reviewerPresence.ts";

function detail(overrides: Record<string, unknown> = {}) {
  return { reviewRequests: { nodes: [] }, reviews: { nodes: [] }, ...overrides };
}

describe("hasReviewer", () => {
  test("a fresh PR with nobody requested has no reviewer", () => {
    expect(hasReviewer(detail(), "author")).toBe(false);
  });

  test("a requested user is a reviewer", () => {
    const nodes = [{ requestedReviewer: { __typename: "User", login: "someone" } }];
    expect(hasReviewer(detail({ reviewRequests: { nodes } }), "author")).toBe(true);
  });

  test("a requested team is a reviewer even though it has no login", () => {
    const nodes = [{ requestedReviewer: { __typename: "Team", slug: "reviewers" } }];
    expect(hasReviewer(detail({ reviewRequests: { nodes } }), "author")).toBe(true);
  });

  test("a submitted review counts after GitHub drops the request", () => {
    const nodes = [{ author: { __typename: "User", login: "someone" } }];
    expect(hasReviewer(detail({ reviews: { nodes } }), "author")).toBe(true);
  });

  test("my own review of my own PR is not a reviewer", () => {
    const nodes = [{ author: { __typename: "User", login: "author" } }];
    expect(hasReviewer(detail({ reviews: { nodes } }), "author")).toBe(false);
  });

  test("bots reviewing on push are not a reviewer being asked", () => {
    const reviews = { nodes: [{ author: { __typename: "Bot", login: "greptile-apps[bot]" } }] };
    expect(hasReviewer(detail({ reviews }), "author")).toBe(false);
  });

  test("missing collections read as no reviewer rather than throwing", () => {
    expect(hasReviewer({}, "author")).toBe(false);
  });
});
