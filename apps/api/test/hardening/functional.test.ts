import { db } from "@repo/db";
import { eq } from "drizzle-orm";
import request from "supertest";
import { organizationDocuments } from "@repo/db";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { limits } from "@/middlewares/rate-limit.middleware";
import { linkInvitesIfProven } from "@/modules/members/members.service";
import { storeUpload } from "@/modules/organizations/organizations.service";
import { adminSql } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { newEvmWallet } from "../helpers/wallets";
import { seedBasket, seedPosition, seedUser } from "../execution/helpers";
import { invite, invitePending, inviteBody, orgWithOwner, rowOf, untilBlockedOnLock } from "../modules/members/helpers";
import { PDF, createOrg, resetOrgDb, user } from "../modules/organizations/helpers";

beforeEach(resetOrgDb);

describe("invites", () => {
  it("an invite created concurrently for the same user does not fail the sign-in that links another one: only that invite waits (savepoint)", async () => {
    const owner = await orgWithOwner(app);
    const u = await user(app, false);
    const { mid, wallet } = await invitePending(app, owner, "VIEWER");
    // A second invite of the same organization for this user is being committed at the same moment (its row is not visible to the link yet).
    let inserted!: () => void;
    let release!: () => void;
    const insertedP = new Promise<void>((r) => (inserted = r));
    const gate = new Promise<void>((r) => (release = r));
    const holder = adminSql.begin(async (sql) => {
      await sql`INSERT INTO app.organization_memberships (id, organization_id, user_id, role, status) VALUES (gen_random_uuid(), ${owner.id}, ${u.userId}, 'VIEWER', 'INVITED')`;
      inserted();
      await gate;
    });
    await insertedP;
    const linking = db.transaction((tx) => linkInvitesIfProven(tx, { userId: u.userId, chain: "base", address: wallet.address.toLowerCase(), method: "eoa_ecdsa", requestId: "test" }));
    await untilBlockedOnLock();
    release();
    await holder;
    await expect(linking).resolves.toBeUndefined();
    expect(await rowOf(mid)).toMatchObject({ status: "PENDING_WALLET_VERIFICATION", user_id: null }); // left for the next sign-in
  });

  it("a rejected invite does not consume the organization's 20/h invite budget; a created one does", async () => {
    const owner = await orgWithOwner(app);
    const wallet = newEvmWallet();
    expect((await invite(app, owner.h, owner.id, inviteBody(wallet, "VIEWER"))).status).toBe(201);
    for (let n = 0; n < 3; n++) expect((await invite(app, owner.h, owner.id, inviteBody(wallet, "VIEWER"))).status).toBe(409);
    expect((await limits.inviteOrg.get(owner.id))?.consumedPoints).toBe(1);
  });
});

describe("document upload", () => {
  it("when the database write after the R2 copy fails, the copied final object is deleted (the incoming one is left to the lifecycle rule)", async () => {
    const u = await user(app);
    const orgId = await createOrg(app, u.h);
    const pre = await request(app).post(`/v1/organizations/${orgId}/documents`).set(u.h).send({ documentType: "government_id", contentType: "application/pdf", sizeBytes: 50 });
    expect(pre.status).toBe(201);
    fakes.r2.put(`incoming/${orgId}/${pre.body.documentId}`, Buffer.concat([PDF, Buffer.alloc(50 - PDF.length)]), "application/pdf");
    const [doc] = await db.select().from(organizationDocuments).where(eq(organizationDocuments.id, pre.body.documentId));
    const finalKey = `documents/${orgId}/${doc!.id}`;
    await expect(storeUpload(doc!, finalKey, async () => { throw new Error("database unavailable"); })).rejects.toThrow("database unavailable");
    expect(fakes.r2.objects.has(finalKey)).toBe(false);
    expect((await db.select().from(organizationDocuments).where(eq(organizationDocuments.id, doc!.id)))[0]).toMatchObject({ status: "pending_upload" });
  });
});

describe("portfolio", () => {
  it("positions carry the basket's name", async () => {
    const basket = await seedBasket({ assets: [{ symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 10_000 }] });
    const u = await seedUser();
    await seedPosition(u.userId, basket, [{ deploymentId: basket.deployments[0]!.deploymentId, quantity: 1n }]);
    const res = await request(app).get("/v1/portfolio").set(u.h);
    expect(res.status).toBe(200);
    expect(res.body.positions[0]).toMatchObject({ basketSlug: basket.slug, basketName: "Test basket" });
  });
});
