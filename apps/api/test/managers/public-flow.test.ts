import request from "supertest";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { applicationEvents, managerApplications, users } from "@repo/db";
import { app } from "../../src/app";
import { webHeaders } from "../helpers/auth";
import { fakes } from "../helpers/fakes";
import { adminSql, resetDb, testDb } from "../helpers/db";
import { newEvmWallet, newSolanaWallet } from "../helpers/wallets";
import { applicationBody, lastCode, submitApplication } from "./helpers";

const db = testDb.db;
const post = (path: string, body?: unknown) => request(app).post(`/v1/manager-applications${path}`).set(webHeaders()).send(body as object);
beforeEach(resetDb);

describe("public manager application flow", () => {
  it("create -> emailed code -> confirm -> status token works", async () => {
    const { id, token, body } = await submitApplication(app);
    const [row] = await db.select().from(managerApplications).where(eq(managerApplications.id, id));
    expect(row).toMatchObject({ status: "SUBMITTED", walletFamily: "evm", walletAddress: body.walletAddress!.toLowerCase() });
    expect(row!.statusTokenHash).toBeTruthy();
    expect(row!.statusTokenHash).not.toBe(token);
    const link = fakes.email.application.find((m) => m.kind === "status_link")!;
    expect(link.data.link).toBe(`http://localhost:3000/managers/status#${token}`);
    const status = await request(app).get("/v1/manager-applications/status").set("X-Application-Token", token);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ status: "SUBMITTED", fullName: "Ada Lovelace", latestMessage: null, canReply: false });
    const events = await db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, id));
    expect(events.map((e) => e.toStatus)).toEqual(["EMAIL_PENDING", "SUBMITTED"]);
  });

  it("status without or with a garbage token -> 401 APPLICATION_TOKEN_INVALID", async () => {
    for (const res of [
      await request(app).get("/v1/manager-applications/status"),
      await request(app).get("/v1/manager-applications/status").set("X-Application-Token", "garbage"),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("APPLICATION_TOKEN_INVALID");
    }
  });

  it("a duplicate open email or wallet -> 409 APPLICATION_EXISTS, including the same EOA on another EVM chain", async () => {
    const first = applicationBody();
    expect((await post("/", first)).status).toBe(201);
    const sameEmail = await post("/", applicationBody({ email: first.email }));
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.error.code).toBe("APPLICATION_EXISTS");
    const otherChain = await post("/", applicationBody({ walletChain: "arbitrum", walletAddress: first.walletAddress }));
    expect(otherChain.status).toBe(409);
    expect(otherChain.body.error.code).toBe("APPLICATION_EXISTS");
    expect((await post("/", applicationBody({ walletChain: "solana", walletAddress: newSolanaWallet().address }))).status).toBe(201);
  });

  it("an invalid address for the chain -> 400", async () => {
    const res = await post("/", applicationBody({ walletChain: "solana", walletAddress: newEvmWallet().address }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("wrong code x5 -> OTP_ATTEMPTS_EXCEEDED, then a resend after the cooldown recovers", async () => {
    const created = await post("/", applicationBody());
    const id = created.body.applicationId as string;
    const wrong = lastCode() === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await post(`/${id}/confirm-email`, { code: wrong })).body.error.code).toBe("OTP_INVALID");
    expect((await post(`/${id}/confirm-email`, { code: lastCode() })).body.error.code).toBe("OTP_ATTEMPTS_EXCEEDED");
    await adminSql`UPDATE app.application_email_codes SET created_at = now() - interval '2 minutes'`;
    expect((await post(`/${id}/resend-code`)).status).toBe(204);
    expect((await post(`/${id}/confirm-email`, { code: lastCode() })).status).toBe(200);
  });

  it("resend within 60 s -> 429 OTP_COOLDOWN; only for EMAIL_PENDING", async () => {
    const created = await post("/", applicationBody());
    const id = created.body.applicationId as string;
    const res = await post(`/${id}/resend-code`);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("OTP_COOLDOWN");
    await post(`/${id}/confirm-email`, { code: lastCode() });
    expect((await post(`/${id}/resend-code`)).status).toBe(404);
  });

  it("an expired code -> OTP_EXPIRED", async () => {
    const created = await post("/", applicationBody());
    await adminSql`UPDATE app.application_email_codes SET expires_at = now() - interval '1 minute'`;
    expect((await post(`/${created.body.applicationId}/confirm-email`, { code: lastCode() })).body.error.code).toBe("OTP_EXPIRED");
  });

  it("code delivery failure -> 503 with the application id, and resend then works", async () => {
    fakes.email.fail = true;
    const res = await post("/", applicationBody());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("OTP_DELIVERY_FAILED");
    const id = res.body.error.details.applicationId as string;
    fakes.email.fail = false;
    await adminSql`UPDATE app.application_email_codes SET created_at = now() - interval '2 minutes'`;
    expect((await post(`/${id}/resend-code`)).status).toBe(204);
    expect((await post(`/${id}/confirm-email`, { code: lastCode() })).status).toBe(200);
  });

  it("reply only while information is required, and only once", async () => {
    const { id, token } = await submitApplication(app);
    const reply = (message: string) => request(app).post("/v1/manager-applications/reply").set(webHeaders()).set("X-Application-Token", token).send({ message });
    const early = await reply("hello");
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("REPLY_NOT_ALLOWED");
    await adminSql`UPDATE app.manager_applications SET status = 'ADDITIONAL_INFORMATION_REQUIRED' WHERE id = ${id}`;
    await adminSql`INSERT INTO app.application_events (id, application_id, actor_type, kind, to_status, message_to_applicant) VALUES (gen_random_uuid(), ${id}, 'ops', 'status_changed', 'ADDITIONAL_INFORMATION_REQUIRED', 'Please send your CV')`;
    const status = await request(app).get("/v1/manager-applications/status").set("X-Application-Token", token);
    expect(status.body).toMatchObject({ canReply: true, latestMessage: "Please send your CV" });
    expect((await reply("Here it is")).status).toBe(204);
    const [row] = await db.select().from(managerApplications).where(eq(managerApplications.id, id));
    expect(row!.status).toBe("SCREENING");
    expect((await reply("again")).status).toBe(409);
  });

  it("rate limits application creation per email -> 429", async () => {
    const first = applicationBody();
    await post("/", first);
    await post("/", first);
    await post("/", first);
    expect((await post("/", first)).status).toBe(429);
  });

  it("a cookie-less browser POST without Origin -> 403", async () => {
    const res = await request(app).post("/v1/manager-applications").send(applicationBody());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_REJECTED");
  });

  it("purge removes stale EMAIL_PENDING applications with their codes and events, and keeps SUBMITTED", async () => {
    const stale = await post("/", applicationBody());
    const { id: kept } = await submitApplication(app);
    await adminSql`UPDATE app.manager_applications SET created_at = now() - interval '25 hours' WHERE id = ${stale.body.applicationId}`;
    await adminSql`UPDATE app.manager_applications SET created_at = now() - interval '25 hours' WHERE id = ${kept}`;
    await adminSql`SELECT app.purge_expired()`;
    const left = await adminSql<{ id: string }[]>`SELECT id FROM app.manager_applications`;
    expect(left.map((r) => r.id)).toEqual([kept]);
    expect(await adminSql`SELECT 1 FROM app.application_events WHERE application_id = ${stale.body.applicationId}`).toHaveLength(0);
  });

  it("a typed address never creates a user", async () => {
    await submitApplication(app);
    expect(await db.select().from(users)).toHaveLength(0);
  });
});
