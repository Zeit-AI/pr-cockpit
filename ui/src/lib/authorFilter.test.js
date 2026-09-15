import { expect, test } from "bun:test";
import { availableAuthors, filterByAuthors } from "./authorFilter.js";

test("author choices are the distinct logins across lists, case-insensitively sorted", () => {
  const open = [{ author: "zoe" }, { author: "Adam" }, { author: null }];
  const closed = [{ author: "bob" }, { author: "zoe" }];
  expect(availableAuthors(open, closed)).toEqual(["Adam", "bob", "zoe"]);
  expect(filterByAuthors(open, ["zoe"])).toEqual([{ author: "zoe" }]);
  expect(filterByAuthors(open, ["zoe", "Adam"])).toEqual([{ author: "zoe" }, { author: "Adam" }]);
  expect(filterByAuthors(open, [])).toBe(open);
});
