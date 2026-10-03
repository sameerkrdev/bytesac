import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverNotification } from "@/services/notifications";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { mockChains, solanaTestWallet } from "../execution/chain-mocks";
import { seedUser } from "../execution/helpers";

async function notification(userId: string, kind = "drifted") {
  const [row] = await adminSql<{ id: string }[]>`INSERT INTO app.notifications (id, user_id, kind, data, dedupe_key) VALUES (gen_random_uuid(), ${userId}, ${kind}, ${adminSql.json({ basketName: "Blue", basketSlug: "blue" })}, ${"k-" + Math.random()}) RETURNING id`;
  return row!.id;
}
const token = (userId: string, value: string, revoked = false) => adminSql`INSERT INTO app.push_tokens (id, user_id, token, revoked_at) VALUES (gen_random_uuid(), ${userId}, ${value}, ${revoked ? adminSql`now()` : null})`;
const revokedTokens = async () => (await adminSql<{ token: string }[]>`SELECT token FROM app.push_tokens WHERE revoked_at IS NOT NULL ORDER BY token`).map((t) => t.token);

beforeEach(async () => { await resetDb(); mockChains(); });

describe("deliverNotification", () => {
  it("emails the verified address and pushes to every non-revoked token with an absolute link", async () => {
    const user = await seedUser({ wallet: solanaTestWallet() });
    await token(user.userId, "tok-a");
    await token(user.userId, "tok-revoked", true);
    const id = await notification(user.userId);
    await deliverNotification(id);
    expect(fakes.email.notification).toEqual([expect.objectContaining({ to: `u-${user.userId.slice(0, 8)}@example.com`, title: "Blue has drifted", idempotencyKey: `notification/${id}` })]);
    expect(fakes.email.notification[0]!.link).toBe("/portfolio"); // no position on this synthetic row: falls back to the list
    expect(fakes.fcm.sent).toHaveLength(1);
    expect(fakes.fcm.sent[0]).toMatchObject({ tokens: ["tok-a"], title: "Blue has drifted", link: expect.stringMatching(/^https?:\/\/.+\/portfolio$/) });
  });

  it("is gated by the preference of each kind", async () => {
    const user = await seedUser({ wallet: solanaTestWallet() });
    await token(user.userId, "tok-a");
    await adminSql`UPDATE app.notification_preferences SET rebalance = false, portfolio_updates = false, manager_updates = false WHERE user_id = ${user.userId}`;
    for (const kind of ["rebalance_available", "drifted", "repair_required", "execution_incomplete", "basket_paused", "lead_changed"]) await deliverNotification(await notification(user.userId, kind));
    expect(fakes.email.notification).toHaveLength(0);
    expect(fakes.fcm.sent).toHaveLength(0);
    await adminSql`UPDATE app.notification_preferences SET rebalance = true WHERE user_id = ${user.userId}`;
    await deliverNotification(await notification(user.userId, "rebalance_available"));
    await deliverNotification(await notification(user.userId, "drifted")); // still off
    expect(fakes.email.notification).toHaveLength(1);
    expect(fakes.fcm.sent).toHaveLength(1);
    await adminSql`UPDATE app.notification_preferences SET portfolio_updates = true, manager_updates = true WHERE user_id = ${user.userId}`;
    for (const kind of ["drifted", "repair_required", "execution_incomplete", "basket_unpaused", "basket_retired", "basket_retirement_pending", "lead_changed"]) await deliverNotification(await notification(user.userId, kind));
    expect(fakes.email.notification).toHaveLength(8);
  });

  it("emails only a verified email contact", async () => {
    const user = await seedUser({ wallet: solanaTestWallet(), email: false });
    await adminSql`INSERT INTO app.contacts (id, user_id, type, value, status) VALUES (gen_random_uuid(), ${user.userId}, 'email', 'unverified@example.com', 'unverified')`;
    await deliverNotification(await notification(user.userId));
    expect(fakes.email.notification).toHaveLength(0);
  });

  it("revokes a token that FCM reports as unregistered or invalid", async () => {
    const user = await seedUser({ wallet: solanaTestWallet() });
    await token(user.userId, "tok-good");
    await token(user.userId, "tok-dead");
    fakes.fcm.dead.add("tok-dead");
    await deliverNotification(await notification(user.userId));
    expect(await revokedTokens()).toEqual(["tok-dead"]);
    await deliverNotification(await notification(user.userId));
    expect(fakes.fcm.sent.at(-1)!.tokens).toEqual(["tok-good"]);
  });

  it("a Resend or FCM failure is logged and the delivery resolves", async () => {
    const user = await seedUser({ wallet: solanaTestWallet() });
    await token(user.userId, "tok-a");
    fakes.email.failNotification = true;
    fakes.fcm.fail = true;
    await expect(deliverNotification(await notification(user.userId))).resolves.toBeUndefined();
    expect(await revokedTokens()).toEqual([]);
  });

  it("a row that is not visible yet throws so the queue retries", async () => {
    await expect(deliverNotification("0190f3a0-0000-7000-8000-000000000001")).rejects.toThrow("not visible");
  });
});

describe("push provider", () => {
  it("without FIREBASE_SERVICE_ACCOUNT nothing is sent and no token is reported dead", async () => {
    const { sendPush } = await vi.importActual<typeof import("@/providers/fcm")>("@/providers/fcm");
    expect(await sendPush(["tok-a"], { title: "t", body: "b", link: "https://example.com" })).toEqual([]);
  });
});
