import { describe, expect, test } from "bun:test";
import {
  matchingNotificationRules,
  notificationRuleMatches,
  parseNotificationSettings,
  type NotificationCondition,
  type NotificationEvent,
  type NotificationRule,
} from "./notificationRules.ts";

const comment: NotificationEvent = {
  id: "comment:1", type: "comment", repo: "example/widgets", number: 7,
  title: "Fix request handling", body: "Please check [retry] handling.",
  actor: { login: "Contributor", type: "human" }, prAuthor: "maintainer", viewerLogin: "maintainer",
  viewerIsAuthor: true, viewerIsAssignee: false, viewerReviewRequested: false,
  reviewState: null, isDraft: false, occurredAt: "2026-09-07T10:00:00Z",
};

function rule(conditions: NotificationCondition[], overrides: Partial<NotificationRule> = {}): NotificationRule {
  return { id: "comments", name: "Comments", enabled: true, events: ["comment"], match: "all", conditions, ...overrides };
}

const human: NotificationCondition = { field: "actorType", operator: "is", value: "human" };
const text: NotificationCondition = { field: "body", operator: "contains", value: "CHECK [RETRY]" };

describe("notification rules", () => {
  test("combines author and literal comment text filters without treating text as a regex", () => {
    const configured = rule([human, text]);
    expect(notificationRuleMatches(configured, comment)).toBe(true);
    expect(notificationRuleMatches(configured, { ...comment, actor: { login: "helper[bot]", type: "bot" } })).toBe(false);
    expect(notificationRuleMatches(configured, { ...comment, body: "Please check retry handling." })).toBe(false);
  });

  test("any-condition rules still require an allowed event type", () => {
    const configured = rule([human, text], { match: "any" });
    expect(notificationRuleMatches(configured, { ...comment, body: "Different text" })).toBe(true);
    expect(notificationRuleMatches(configured, { ...comment, type: "review" })).toBe(false);
  });

  test("unknown authors and absent comment bodies cannot satisfy negative filters", () => {
    const configured = rule([
      { field: "actorType", operator: "isNot", value: "bot" },
      { field: "body", operator: "notContains", value: "automated" },
    ]);
    expect(notificationRuleMatches(configured, comment)).toBe(true);
    expect(notificationRuleMatches(configured, { ...comment, actor: { login: null, type: "unknown" } })).toBe(false);
    expect(notificationRuleMatches(configured, { ...comment, body: null })).toBe(false);
  });

  test("resolves the viewer only for identity conditions, without assuming a missing viewer", () => {
    const configured = rule([
      { field: "prAuthor", operator: "is", value: "$me" },
      { field: "actor", operator: "isNot", value: "$me" },
    ]);
    expect(notificationRuleMatches(configured, comment)).toBe(true);
    expect(notificationRuleMatches(configured, { ...comment, actor: { login: "MAINTAINER", type: "human" } })).toBe(false);
    expect(notificationRuleMatches(configured, { ...comment, viewerLogin: "" })).toBe(false);
  });

  test("review-request rules can match the requested viewer without inventing a requesting author", () => {
    const configured = rule([{ field: "participation", operator: "is", value: "reviewer" }], { events: ["review_requested"] });
    const requested: NotificationEvent = {
      ...comment, type: "review_requested", body: null,
      actor: { login: null, type: "unknown" }, viewerReviewRequested: true,
    };
    expect(notificationRuleMatches(configured, requested)).toBe(true);
    expect(notificationRuleMatches(configured, { ...requested, viewerReviewRequested: false })).toBe(false);
  });

  test("master and individual switches prevent otherwise matching rules", () => {
    const configured = rule([]);
    expect(matchingNotificationRules({ enabled: false, rules: [configured] }, comment)).toEqual([]);
    expect(matchingNotificationRules({ enabled: true, rules: [{ ...configured, enabled: false }] }, comment)).toEqual([]);
  });

  test("rejects invalid field/operator/value combinations instead of weakening a rule", () => {
    expect(() => parseNotificationSettings({ enabled: true, rules: [rule([{ field: "actorType", operator: "contains", value: "human" }])] })).toThrow();
    expect(() => parseNotificationSettings({ enabled: true, rules: [rule([{ field: "body", operator: "contains", value: " " }])] })).toThrow();
    expect(() => parseNotificationSettings({ enabled: true, rules: [rule([{ field: "actorType", operator: "is", value: "unknown" }])] })).toThrow();
    expect(() => parseNotificationSettings({ enabled: true, rules: [rule([]), rule([])] })).toThrow();
  });
});
