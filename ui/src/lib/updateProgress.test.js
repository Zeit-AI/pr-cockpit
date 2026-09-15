import { describe, expect, test } from "bun:test";
import { pollIntervalMs, updateOutcome } from "./updateProgress.js";

describe("pollIntervalMs", () => {
  test("idle polling is slow: it only has to catch someone else's push", () => {
    expect(pollIntervalMs({})).toBe(5 * 60 * 1000);
  });

  test("an update in flight polls fast enough to see the server come back", () => {
    expect(pollIntervalMs({ updating: true })).toBe(1000);
  });

  test("the manual check polls fast while it waits", () => {
    expect(pollIntervalMs({ manual: true })).toBe(1000);
  });
});

describe("updateOutcome", () => {
  const rev = "aaaa";

  test("a new revision means this window is running a replaced build", () => {
    expect(updateOutcome({ rev: "bbbb", loadedRev: rev, updateAvailable: false, updating: true })).toBe("reload");
  });

  test("reload wins even when an update is not in flight, so a background push still lands", () => {
    expect(updateOutcome({ rev: "bbbb", loadedRev: rev, updateAvailable: false, updating: false })).toBe("reload");
  });

  test("the first response only records the revision", () => {
    expect(updateOutcome({ rev, loadedRev: null, updateAvailable: false, updating: false })).toBe("wait");
  });

  test("an update that had nothing to pull settles instead of hanging", () => {
    // the exact case that left the button looking unclicked: same revision, no reload coming
    expect(updateOutcome({ rev, loadedRev: rev, updateAvailable: false, updating: true })).toBe("settled");
  });

  test("still waiting while the old server reports the update it has not taken yet", () => {
    expect(updateOutcome({ rev, loadedRev: rev, updateAvailable: true, updating: true })).toBe("wait");
  });

  test("an idle window at the current revision does nothing", () => {
    expect(updateOutcome({ rev, loadedRev: rev, updateAvailable: false, updating: false })).toBe("wait");
  });

  test("a response with no revision is never acted on", () => {
    expect(updateOutcome({ rev: null, loadedRev: rev, updateAvailable: true, updating: true })).toBe("wait");
  });
});
