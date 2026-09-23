import { expect, test } from "bun:test";
import { commentableLines, foldIntoBody, isAnchorable, isUnresolvableAnchorError } from "./reviewAnchors.ts";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,4 @@ export function a() {
 keep
-old
+new
+added
 tail
@@ -40,2 +41,2 @@
 far
-gone
+here
diff --git a/src/removed.ts b/src/removed.ts
deleted file mode 100644
--- a/src/removed.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
`;

test("anchors land only on lines the current diff shows", () => {
  const lines = commentableLines(PATCH);
  expect(isAnchorable(lines, { path: "src/a.ts", line: 12, side: "RIGHT", body: "" })).toBe(true);
  expect(isAnchorable(lines, { path: "src/a.ts", line: 11, side: "LEFT", body: "" })).toBe(true);
  expect(isAnchorable(lines, { path: "src/a.ts", line: 30, side: "RIGHT", body: "" })).toBe(false);
  expect(isAnchorable(lines, { path: "src/renamed-away.ts", line: 1, side: "RIGHT", body: "" })).toBe(false);
  expect(isAnchorable(lines, { path: "src/removed.ts", line: 2, side: "LEFT", body: "" })).toBe(true);
  // a range must stay inside one hunk
  expect(isAnchorable(lines, { path: "src/a.ts", line: 13, side: "RIGHT", startLine: 10, startSide: "RIGHT", body: "" })).toBe(true);
  expect(isAnchorable(lines, { path: "src/a.ts", line: 42, side: "RIGHT", startLine: 12, startSide: "RIGHT", body: "" })).toBe(false);
});

test("unplaced comments keep their location and text in the review body", () => {
  const body = foldIntoBody("summary", [{ path: "x.ts", line: 9, side: "RIGHT", startLine: 7, body: "two\nlines" }]);
  expect(body.startsWith("summary\n\n")).toBe(true);
  expect(body).toContain("**`x.ts` L7-L9**\n> two\n> lines");
  expect(foldIntoBody("summary", [])).toBe("summary");
});

test("only GitHub's anchor rejection triggers the fallback", () => {
  expect(isUnresolvableAnchorError(new Error('POST /x failed: 422 {"errors":["Line could not be resolved"]}'))).toBe(true);
  expect(isUnresolvableAnchorError(new Error('POST /x failed: 422 {"errors":["Path could not be resolved"]}'))).toBe(true);
  expect(isUnresolvableAnchorError(new Error("POST /x failed: 422 Can not approve your own pull request"))).toBe(false);
  expect(isUnresolvableAnchorError(new Error("POST /x failed: 502"))).toBe(false);
});
