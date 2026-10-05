import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { notify } from "@/modules/notifications/notifications.service";
import { adminSql, resetDb, testDb } from "../../helpers/db";
import { seedUser } from "../../helpers/execution";
import { mockChains, solanaTestWallet } from "../../helpers/chain-mocks";

type H = Record<string, string>;
const list = (h: H, q = "") => request(app).get(`/v1/me/notifications${q}`).set(h);
const read = (h: H, body: object) => request(app).post("/v1/me/notifications/read").set(h).send(body);

/** `n` notifications for the user, oldest first (one minute apart). */
async function seed(userId: string, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [row] = await adminSql<{ id: string }[]>`INSERT INTO app.notifications (id, user_id, kind, data, dedupe_key, created_at)
      VALUES (gen_random_uuid(), ${userId}, 'drifted', ${adminSql.json({ basketName: "Blue" })}, ${"k" + i}, now() - ${(n - i) + " minutes"}::interval) RETURNING id`;
    ids.push(row!.id);
  }
  return ids;
}

beforeEach(async () => { await resetDb(); mockChains(); });

describe("inbox", () => {
  it("lists newest first with a keyset cursor and the unread count", async () => {
    const user = await seedUser({ wallet: solanaTestWallet() });
    const ids = await seed(user.userId, 5);
    const first = await list(user.h, "?limit=2");
    expect(first.status).toBe(200);
    expect(first.body.items.map((i: { id: string }) => i.id)).toEqual([ids[4], ids[3]]);
    expect(first.body.unreadCount).toBe(5);
    expect(first.body.items[0]).toMatchObject({ kind: "drifted", title: "Blue has drifted", readAt: null });
    const second = await list(user.h, `?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.items.map((i: { id: string }) => i.id)).toEqual([ids[2], ids[1]]);
    const third = await list(user.h, `?limit=2&cursor=${second.body.nextCursor}`);
    expect(third.body.items.map((i: { id: string }) => i.id)).toEqual([ids[0]]);
    expect(third.body.nextCursor).toBeNull();
    expect((await list(user.h, "?cursor=not-a-cursor")).status).toBe(400);
    expect((await list(user.h, "?limit=51")).status).toBe(400);
  });

  it("marks own notifications read by ids and all; another user's ids match nothing", async () => {
    const user = await seedUser({ wallet: solanaTestWallet() });
    const other = await seedUser({ wallet: solanaTestWallet() });
    const mine = await seed(user.userId, 3);
    const theirs = await seed(other.userId, 1);
    expect((await read(user.h, { ids: [mine[0], theirs[0]] })).status).toBe(204);
    expect((await list(user.h)).body.unreadCount).toBe(2);
    expect((await list(other.h)).body.unreadCount).toBe(1);
    expect((await read(user.h, { all: true })).status).toBe(204);
    const after = await list(user.h);
    expect(after.body.unreadCount).toBe(0);
    expect(after.body.items.every((i: { readAt: string | null }) => i.readAt !== null)).toBe(true);
    expect((await list(other.h)).body.unreadCount).toBe(1);
    expect((await read(user.h, {})).status).toBe(400);
    expect((await read(user.h, { ids: [] })).status).toBe(400);
  });

  it("a dedupe key conflict inserts nothing", async () => {
    const user = await seedUser({ wallet: solanaTestWallet() });
    const n = { userId: user.userId, kind: "drifted" as const, data: {}, dedupeKey: "same" };
    expect(await notify(testDb.db, n)).toEqual(expect.any(String));
    expect(await notify(testDb.db, n)).toBeNull();
    expect(await adminSql`SELECT 1 FROM app.notifications`).toHaveLength(1);
  });

  it("needs a session", async () => {
    expect((await request(app).get("/v1/me/notifications")).status).toBe(401);
  });

  it("registers, un-revokes and revokes a push token (an unknown token or someone else's changes nothing)", async () => {
    const user = await seedUser({ wallet: solanaTestWallet() });
    const other = await seedUser({ wallet: solanaTestWallet() });
    const post = (h: H, path: string, body: object) => request(app).post(`/v1/me/push-tokens${path}`).set(h).send(body);
    expect((await post(user.h, "", { token: "tok-1", userAgent: "Firefox" })).status).toBe(204);
    expect((await post(other.h, "/revoke", { token: "tok-1" })).status).toBe(204);
    expect((await adminSql`SELECT revoked_at FROM app.push_tokens WHERE token = 'tok-1'`)[0]).toEqual({ revoked_at: null });
    expect((await post(user.h, "/revoke", { token: "tok-1" })).status).toBe(204);
    expect((await adminSql`SELECT revoked_at FROM app.push_tokens WHERE token = 'tok-1'`)[0]!.revoked_at).toBeTruthy();
    expect((await post(user.h, "", { token: "tok-1" })).status).toBe(204);
    expect((await adminSql`SELECT revoked_at FROM app.push_tokens WHERE token = 'tok-1'`)[0]).toEqual({ revoked_at: null });
    expect((await post(user.h, "", { token: "" })).status).toBe(400);
  });

  it("the app registers an Expo token with its platform; mismatched provider and platform are refused", async () => {
    const user = await seedUser({ wallet: solanaTestWallet() });
    const post = (body: object) => request(app).post("/v1/me/push-tokens").set(user.h).send(body);
    expect((await post({ token: "ExponentPushToken[abc-123]", platform: "android", provider: "expo" })).status).toBe(204);
    expect((await adminSql`SELECT platform, provider FROM app.push_tokens WHERE token = 'ExponentPushToken[abc-123]'`)[0]).toEqual({ platform: "android", provider: "expo" });
    expect((await post({ token: "tok-web" })).status).toBe(204);
    expect((await adminSql`SELECT platform, provider FROM app.push_tokens WHERE token = 'tok-web'`)[0]).toEqual({ platform: "web", provider: "fcm" });
    expect((await post({ token: "not-an-expo-token", platform: "ios", provider: "expo" })).status).toBe(400);
    expect((await post({ token: "ExponentPushToken[x]", platform: "web", provider: "expo" })).status).toBe(400);
    expect((await post({ token: "fcm-token", platform: "ios", provider: "fcm" })).status).toBe(400);
  });
});
