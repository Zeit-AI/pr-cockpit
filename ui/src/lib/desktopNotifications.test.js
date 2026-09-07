import { describe, expect, test } from "bun:test";
import { NOTIFICATION_CLAIM_LIMIT, canDeliverNotifications, drainNotifications, notificationHref } from "./desktopNotifications.js";

function batch(size, offset = 0) {
  return Array.from({ length: size }, (_, i) => ({ id: `n${offset + i}`, title: "t", body: "b", repo: "acme/widgets", number: offset + i }));
}

describe("desktop notification delivery", () => {
  test("delivers only when the server opt-in and a granted permission both hold", () => {
    expect(canDeliverNotifications(true, "granted")).toBe(true);
    expect(canDeliverNotifications(false, "granted")).toBe(false);
    expect(canDeliverNotifications(true, "default")).toBe(false);
    expect(canDeliverNotifications(true, "denied")).toBe(false);
    expect(canDeliverNotifications(true, "unsupported")).toBe(false);
  });

  test("never claims when it could not show the result", async () => {
    let claims = 0;
    const claim = async () => {
      claims++;
      return { notifications: batch(1) };
    };
    expect(await drainNotifications({ eligible: () => false, claim, show: () => {} })).toBe(0);
    expect(claims).toBe(0);
  });

  test("keeps claiming while the server returns full batches", async () => {
    const batches = [batch(NOTIFICATION_CLAIM_LIMIT), batch(3, NOTIFICATION_CLAIM_LIMIT), batch(99, 999)];
    const shown = [];
    const delivered = await drainNotifications({
      eligible: () => true,
      claim: async () => ({ notifications: batches.shift() }),
      show: (n) => shown.push(n.id),
    });
    expect(delivered).toBe(NOTIFICATION_CLAIM_LIMIT + 3);
    expect(shown).toHaveLength(NOTIFICATION_CLAIM_LIMIT + 3);
    expect(batches).toHaveLength(1);
  });

  test("a claim that resolves after the user opted out shows nothing", async () => {
    let eligible = true;
    let resolveClaim;
    const shown = [];
    const pending = drainNotifications({
      eligible: () => eligible,
      claim: () => new Promise((resolve) => (resolveClaim = resolve)),
      show: (n) => shown.push(n.id),
    });
    eligible = false; // disabled in Settings or permission revoked while the claim was in flight
    resolveClaim({ notifications: batch(2) });
    expect(await pending).toBe(0);
    expect(shown).toEqual([]);
  });

  test("revoking mid-batch stops both showing and further claims", async () => {
    let claims = 0;
    let eligible = true;
    const shown = [];
    const delivered = await drainNotifications({
      eligible: () => eligible,
      claim: async () => {
        claims++;
        return { notifications: batch(NOTIFICATION_CLAIM_LIMIT) };
      },
      show: (n) => {
        shown.push(n.id);
        if (shown.length === 2) eligible = false;
      },
    });
    expect(delivered).toBe(2);
    expect(shown).toEqual(["n0", "n1"]);
    expect(claims).toBe(1);
  });

  test("claim failures propagate so the UI can show them", async () => {
    await expect(drainNotifications({ eligible: () => true, claim: async () => { throw new Error("notifications 503"); }, show: () => {} })).rejects.toThrow("notifications 503");
  });

  test("click target is the exact PR route", () => {
    expect(notificationHref({ repo: "acme/widgets", number: 42 })).toBe("#/pr/acme/widgets/42");
  });
});
