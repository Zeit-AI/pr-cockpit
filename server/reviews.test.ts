import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendReviewTurn,
  listReviewPrs,
  parseTranscript,
  readReviewMeta,
  readTranscript,
  resolveReviewFile,
  reviewContentType,
  reviewDir,
  writeReviewMeta,
} from "./reviews.ts";

// a directory-wide `bun test server/` shares one process, so the data dir is restored afterwards
const dataDir = mkdtempSync(join(tmpdir(), "pr-cockpit-reviews-"));
const previousDataDir = Bun.env.COCKPIT_DATA_DIR;
Bun.env.COCKPIT_DATA_DIR = dataDir;
afterAll(() => {
  if (previousDataDir === undefined) delete Bun.env.COCKPIT_DATA_DIR;
  else Bun.env.COCKPIT_DATA_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("reviewDir", () => {
  test("keeps each PR under its own owner__repo directory and creates it on demand", () => {
    expect(reviewDir("owner/repo", 7)).toBe(`${dataDir}/reviews/owner__repo/pr-7`);
    expect(reviewDir("owner/repo", 7)).toBe(reviewDir("owner/repo", 7));
    // a sibling of mirrors/worktrees/agents, never inside one - nothing sweeps or re-checkouts it
    expect(reviewDir("owner/repo", 7).startsWith(`${dataDir}/reviews/`)).toBe(true);
  });
});

describe("resolveReviewFile", () => {
  test("resolves plain relative paths inside the PR's own review directory", () => {
    expect(resolveReviewFile("owner/repo", 3, "index.html")).toBe(`${dataDir}/reviews/owner__repo/pr-3/index.html`);
    expect(resolveReviewFile("owner/repo", 3, "assets/map.svg")).toBe(`${dataDir}/reviews/owner__repo/pr-3/assets/map.svg`);
    // an ordinary percent-encoded name is a real file name, not an escape attempt
    expect(resolveReviewFile("owner/repo", 3, "call%20graph.svg")).toBe(`${dataDir}/reviews/owner__repo/pr-3/call graph.svg`);
  });

  test("refuses traversal, absolute paths, and anything else that escapes the directory", () => {
    const escapes = ["", "../meta.json", "a/../../b", "/etc/passwd", "./index.html", "a\\b", "a\0b", "../../pr-4/index.html"];
    // percent-encoded spellings of the same attacks, and a malformed escape
    const encoded = ["%2e%2e/meta.json", "%2e%2e%2fmeta.json", "a%2f%2e%2e%2fb", "%ZZ"];
    for (const bad of [...escapes, ...encoded]) {
      expect(resolveReviewFile("owner/repo", 3, bad)).toBeNull();
    }
  });
});

describe("reviewContentType", () => {
  test("serves the agent's own artifact types correctly and falls back to a binary type", () => {
    expect(reviewContentType("index.html")).toBe("text/html; charset=utf-8");
    expect(reviewContentType("transcript.md")).toBe("text/markdown; charset=utf-8");
    expect(reviewContentType("meta.json")).toBe("application/json; charset=utf-8");
    expect(reviewContentType("diagram.SVG")).toBe("image/svg+xml");
    expect(reviewContentType("mystery.bin")).toBe("application/octet-stream");
  });
});

describe("transcript", () => {
  test("round-trips both sides of the chat and keeps markdown bodies intact", async () => {
    await appendReviewTurn("owner/repo", 11, "user", "why is there a union visitor in appRouter.ts?");
    await appendReviewTurn("owner/repo", 11, "agent", "It special-cases remote tables.\n\n```ts\nconst x = 1;\n```");
    const turns = await readTranscript("owner/repo", 11);
    expect(turns.map((t) => t.role)).toEqual(["user", "agent"]);
    expect(turns[0]!.text).toBe("why is there a union visitor in appRouter.ts?");
    expect(turns[1]!.text).toBe("It special-cases remote tables.\n\n```ts\nconst x = 1;\n```");
    expect(Date.parse(turns[0]!.at)).not.toBeNaN();
  });

  test("appends rather than replaces, so the log survives across sessions", async () => {
    await appendReviewTurn("owner/repo", 12, "user", "first");
    await appendReviewTurn("owner/repo", 12, "agent", "second");
    await appendReviewTurn("owner/repo", 12, "user", "third");
    expect((await readTranscript("owner/repo", 12)).map((t) => t.text)).toEqual(["first", "second", "third"]);
  });

  test("a heading-looking line inside an answer is content, not a turn boundary", () => {
    const turns = parseTranscript(
      "<!-- turn:agent 2026-01-01T00:00:00.000Z -->\n### Review agent\n\nintro\n\n### Review agent\n\ntail\n",
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]!.text).toBe("intro\n\n### Review agent\n\ntail");
  });

  test("an empty or absent transcript is no turns, not an error", async () => {
    expect(await readTranscript("owner/repo", 99)).toEqual([]);
    expect(parseTranscript("")).toEqual([]);
  });
});

describe("the message queue in meta", () => {
  test("round-trips pending messages and tolerates an older or hand-edited file", async () => {
    await writeReviewMeta("owner/repo", 31, { pending: ["first", "second"] });
    expect((await readReviewMeta("owner/repo", 31)).pending).toEqual(["first", "second"]);
    await writeReviewMeta("owner/repo", 31, { pending: ["second"] });
    expect((await readReviewMeta("owner/repo", 31)).pending).toEqual(["second"]);

    // a meta.json written before the queue existed, and one with the wrong shape, must both drain cleanly
    await Bun.write(`${reviewDir("owner/repo", 32)}/meta.json`, JSON.stringify({ model: "opus" }));
    expect((await readReviewMeta("owner/repo", 32)).pending).toEqual([]);
    await Bun.write(`${reviewDir("owner/repo", 33)}/meta.json`, JSON.stringify({ pending: "nope" }));
    expect((await readReviewMeta("owner/repo", 33)).pending).toEqual([]);
  });
});

describe("listReviewPrs", () => {
  test("finds every PR with a review directory so queues resume after a restart", async () => {
    await writeReviewMeta("owner/repo", 41, { pending: ["q"] });
    await writeReviewMeta("other/thing", 42, {});
    const found = listReviewPrs();
    expect(found).toContainEqual({ repo: "owner/repo", number: 41 });
    expect(found).toContainEqual({ repo: "other/thing", number: 42 });
  });
});

describe("meta", () => {
  test("merges patches, stamps timestamps, and keeps createdAt from the first write", async () => {
    const first = await writeReviewMeta("owner/repo", 21, { headSha: "a".repeat(40), model: "opus" });
    const second = await writeReviewMeta("owner/repo", 21, { htmlHeadSha: "a".repeat(40), sessionStarted: true });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.headSha).toBe("a".repeat(40));
    expect(second.model).toBe("opus");
    expect(second.sessionStarted).toBe(true);
    expect(await readReviewMeta("owner/repo", 21)).toEqual(second);
  });

  test("a missing or corrupt meta.json reads as empty rather than throwing", async () => {
    expect((await readReviewMeta("owner/repo", 22)).headSha).toBeNull();
    await Bun.write(`${reviewDir("owner/repo", 23)}/meta.json`, "{ not json");
    expect((await readReviewMeta("owner/repo", 23)).sessionStarted).toBe(false);
  });
});
