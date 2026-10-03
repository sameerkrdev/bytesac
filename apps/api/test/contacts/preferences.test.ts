import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { signIn, webHeaders } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { newEvmWallet } from "../helpers/wallets";

beforeEach(resetDb);

describe("notification preferences", () => {
  it("defaults, partial update, validation, CSRF", async () => {
    const s = await signIn(app, newEvmWallet(), "base");
    const get = await request(app).get("/v1/me/notification-preferences").set("Cookie", s.cookie!);
    expect(get.body).toEqual({ rebalance: true, portfolioUpdates: true, managerUpdates: true, offers: false, productUpdates: false, marketing: false });
    const patch = await request(app).patch("/v1/me/notification-preferences").set(webHeaders(s.cookie)).send({ marketing: true });
    expect(patch.status).toBe(200);
    expect(patch.body.marketing).toBe(true);
    expect(patch.body.rebalance).toBe(true);
    expect((await request(app).patch("/v1/me/notification-preferences").set(webHeaders(s.cookie)).send({})).status).toBe(400);
    expect((await request(app).patch("/v1/me/notification-preferences").set(webHeaders(s.cookie)).send({ security: false })).status).toBe(400);
    expect((await request(app).patch("/v1/me/notification-preferences").set("Cookie", s.cookie!).send({ offers: true })).status).toBe(403);
  });
});
