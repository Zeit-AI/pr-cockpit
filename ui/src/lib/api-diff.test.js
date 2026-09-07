import { afterEach, expect, test } from "bun:test";
import { fetchPrDiff } from "./api.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("only an explicit mirror-building response permits automatic diff retry", async () => {
  globalThis.fetch = async () => Response.json({ error: "Network is unreachable" }, { status: 503 });
  const unavailable = await fetchPrDiff("example/widgets", 7);
  expect(unavailable.ok).toBe(false);
  expect(unavailable.building).toBe(false);
  expect(unavailable.retryAfterMs).toBeUndefined();

  globalThis.fetch = async () => Response.json({ building: true }, { status: 503, headers: { "retry-after": "2" } });
  const preparing = await fetchPrDiff("example/widgets", 7);
  expect(preparing.building).toBe(true);
  expect(preparing.retryAfterMs).toBe(2_000);
});
