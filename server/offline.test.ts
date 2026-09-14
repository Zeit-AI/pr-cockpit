import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

process.env.COCKPIT_DATA_DIR = mkdtempSync(`${tmpdir()}/cockpit-offline-`);

const { isRepoPinned, pinRepo, pinnedRepos, staleFileContents, unpinRepo } = await import("./offline.ts");
const { db, saveFileContents } = await import("./db.ts");

beforeEach(() => {
  db.exec("DELETE FROM offline_pins");
  db.exec("DELETE FROM file_contents");
});

describe("offline pins", () => {
  test("a repo is unpinned until it is pinned", () => {
    expect(isRepoPinned("acme/repo")).toBe(false);
    pinRepo("acme/repo");
    expect(isRepoPinned("acme/repo")).toBe(true);
  });

  test("pinning twice is not an error and does not duplicate the repo", () => {
    pinRepo("acme/repo");
    pinRepo("acme/repo");
    expect(pinnedRepos()).toEqual(["acme/repo"]);
  });

  test("unpinning removes only that repo", () => {
    pinRepo("acme/one");
    pinRepo("acme/two");
    unpinRepo("acme/one");
    expect(pinnedRepos()).toEqual(["acme/two"]);
  });
});

describe("stale fallback", () => {
  test("returns the same path at another commit", () => {
    saveFileContents("old-sha", "src/a.ts", "previous contents");
    expect(staleFileContents("src/a.ts", "new-sha")).toEqual({ content: "previous contents", sha: "old-sha" });
  });

  test("never returns the commit that was asked for", () => {
    saveFileContents("wanted-sha", "src/a.ts", "exact");
    expect(staleFileContents("src/a.ts", "wanted-sha")).toBe(null);
  });

  test("prefers the most recently cached copy", () => {
    saveFileContents("older", "src/a.ts", "older contents");
    saveFileContents("newer", "src/a.ts", "newer contents");
    expect(staleFileContents("src/a.ts", "head")?.content).toBe("newer contents");
  });

  test("an uncached path has no fallback", () => {
    expect(staleFileContents("src/never-seen.ts", "head")).toBe(null);
  });
});
