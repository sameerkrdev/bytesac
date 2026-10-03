import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { redis } from "@/middlewares/rate-limit.middleware";
import { adminSql } from "../../helpers/db";
import { fakes } from "../../helpers/fakes";
import { opsUser } from "../manager-applications/helpers";
import { resetOrgDb, user } from "../organizations/helpers";
import {
  activeInstrument, basketOrg, basketRow, createBasket, decideBasket, decision, eventKinds, getBasket, opsGet, post, publishBasket, save, saveOpen, submitBasket, validContent,
} from "./helpers";

let ctx: Awaited<ReturnType<typeof basketOrg>>;
let reviewer: { userId: string; h: Record<string, string> };
let admin: { userId: string; h: Record<string, string> };
let crypto: string;
let other: string;
let stable: string;
let rwa: string;

beforeAll(async () => {
  await resetOrgDb();
  ctx = await basketOrg();
  reviewer = await opsUser(app, "ops_reviewer");
  admin = await opsUser(app, "ops_admin");
  [crypto, other] = [await activeInstrument(ctx.owner.userId), await activeInstrument(ctx.owner.userId)];
  stable = await activeInstrument(ctx.owner.userId, { assetType: "STABLECOIN" });
  rwa = await activeInstrument(ctx.owner.userId, { assetType: "TOKENIZED_TREASURY" });
});
beforeEach(() => redis.flushdb());

/** A basket with valid content, ready to submit. */
async function ready(assets: [string, string] = [crypto, other]) {
  const b = await createBasket(ctx.owner.h, ctx.owner.id);
  await saveOpen(ctx.owner.h, b.id, validContent(...assets));
  return { id: b.id, vid: b.openVersion.id };
}
const versionRow = async (vid: string) => (await adminSql`SELECT * FROM app.basket_versions WHERE id = ${vid}`)[0]!;

describe("submit", () => {
  it("refuses an invalid draft with the exact issue codes and changes nothing", async () => {
    const b = await createBasket(ctx.owner.h, ctx.owner.id);
    const res = await submitBasket(ctx.owner.h, b.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("BASKET_VALIDATION_FAILED");
    expect(res.body.error.details.issues.map((i: { code: string }) => i.code)).toEqual(["BASKET_NAME_REQUIRED", "DISCLOSURE_MISSING", "ASSET_COUNT_INVALID", "ALLOCATION_TOTAL_INVALID", "MINIMUM_INVESTMENT_INVALID"]);
    expect((await versionRow(b.openVersion.id)).status).toBe("draft");
  });

  it("freezes and hashes a valid draft, and pins the always-on disclosures", async () => {
    const b = await ready();
    const res = await submitBasket(ctx.owner.h, b.id);
    expect(res.status).toBe(200);
    expect(res.body.openVersion).toMatchObject({ status: "in_review", contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(res.body.openVersion.disclosures.map((d: { key: string }) => d.key)).toEqual(["fees_and_costs", "no_guarantee", "platform_fee", "self_custody_wallet", "user_consent_rebalance"]);
    const row = await versionRow(b.vid);
    expect(row).toMatchObject({ content_hash: res.body.openVersion.contentHash, submitted_by_user_id: ctx.owner.userId, disclosures_revision: 1 });
    expect(await eventKinds(b.id)).toContain("submitted");
    expect(fakes.email.basket.filter((e) => e.kind === "submitted")).toHaveLength(1);
    const edit = await save(ctx.owner.h, b.id, { expectedUpdatedAt: res.body.openVersion.updatedAt, thesis: "after submit" });
    expect(edit.status).toBe(409);
  });

  it("pins stablecoin and tokenized-asset notices by asset type", async () => {
    const s = await ready([crypto, stable]);
    const r = await ready([crypto, rwa]);
    const both = await createBasket(ctx.owner.h, ctx.owner.id);
    await saveOpen(ctx.owner.h, both.id, { ...validContent(stable, rwa) });
    const keys = async (id: string) => (await submitBasket(ctx.owner.h, id)).body.openVersion.disclosures.map((d: { key: string }) => d.key);
    const stableKeys = await keys(s.id);
    expect(stableKeys).toContain("stablecoin_depeg");
    expect(stableKeys).not.toContain("rwa_issuer_transfer_redemption");
    const rwaKeys = await keys(r.id);
    expect(rwaKeys.filter((k: string) => k.startsWith("rwa"))).toEqual(["rwa_issuer_transfer_redemption"]);
    expect(rwaKeys).not.toContain("stablecoin_depeg");
    const k = await keys(both.id);
    expect(k).toEqual(expect.arrayContaining(["stablecoin_depeg", "rwa_issuer_transfer_redemption"]));
  });

  it("can be withdrawn before a decision and resubmitted; a viewer cannot withdraw", async () => {
    const b = await ready();
    await submitBasket(ctx.owner.h, b.id);
    const back = await post(ctx.owner.h, `/v1/baskets/${b.id}/withdraw`);
    expect(back.status).toBe(200);
    expect(back.body.openVersion.status).toBe("draft");
    expect((await post(ctx.owner.h, `/v1/baskets/${b.id}/withdraw`)).status).toBe(409);
    expect((await submitBasket(ctx.owner.h, b.id)).status).toBe(200);
    expect((await post(ctx.members.VIEWER.h, `/v1/baskets/${b.id}/withdraw`)).status).toBe(403);
  });
});

describe("decision", () => {
  it("lets a reviewer return, reject and escalate but not approve; only an admin approves", async () => {
    const b = await ready();
    await submitBasket(ctx.owner.h, b.id);
    const denied = await decideBasket(reviewer.h, b.id, b.vid, decision("approved"));
    expect(denied.status).toBe(403);
    expect((await versionRow(b.vid)).status).toBe("in_review");
    const ok = await decideBasket(admin.h, b.id, b.vid, decision("approved", { internalNote: "looks fine" }));
    expect(ok.status).toBe(200);
    const row = await versionRow(b.vid);
    expect(row).toMatchObject({ status: "approved", approved_by_user_id: admin.userId });
    expect(row.approved_hash).toBe(row.content_hash);
    const [review] = await adminSql`SELECT reviewed_hash, internal_note FROM app.basket_reviews WHERE version_id = ${b.vid}`;
    expect(review).toMatchObject({ reviewed_hash: row.content_hash, internal_note: "looks fine" });
    expect(fakes.email.basket.map((e) => e.kind)).toContain("approved");
    expect((await decideBasket(admin.h, b.id, b.vid, decision("approved"))).status).toBe(409);
    expect((await post(ctx.owner.h, `/v1/ops/baskets/${b.id}/versions/${b.vid}/decision`, decision("approved"))).status).toBe(403);
  });

  it("refuses an approval when the content changed after submit", async () => {
    const b = await ready();
    await submitBasket(ctx.owner.h, b.id);
    await adminSql`UPDATE app.basket_versions SET thesis = 'sneaky edit' WHERE id = ${b.vid}`;
    const res = await decideBasket(admin.h, b.id, b.vid, decision("approved"));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION", message: "The submission changed; ask the manager to resubmit." });
    expect((await versionRow(b.vid)).status).toBe("in_review");
  });

  it("changes required needs a message; the manager sees it, never the internal note, and can resubmit", async () => {
    const b = await ready();
    await submitBasket(ctx.owner.h, b.id);
    expect((await decideBasket(reviewer.h, b.id, b.vid, decision("changes_required"))).status).toBe(400);
    expect((await decideBasket(reviewer.h, b.id, b.vid, decision("rejected"))).status).toBe(400);
    const res = await decideBasket(reviewer.h, b.id, b.vid, decision("changes_required", {
      messageToManager: "Explain the thesis", internalNote: "SECRET-INTERNAL", sectionComments: [{ section: "thesis", comment: "Too thin" }],
    }));
    expect(res.status).toBe(200);
    expect(res.body.reviews[0]).toMatchObject({ internalNote: "SECRET-INTERNAL" });
    const manager = await getBasket(ctx.owner.h, b.id);
    expect(manager.body.openVersion.status).toBe("changes_required");
    expect(manager.body.reviews[0]).toMatchObject({ decision: "changes_required", messageToManager: "Explain the thesis", sectionComments: [{ section: "thesis", comment: "Too thin" }] });
    expect(JSON.stringify(manager.body)).not.toContain("SECRET-INTERNAL");
    expect(JSON.stringify(manager.body)).not.toContain("internalNote");
    expect(fakes.email.basket.find((e) => e.kind === "changes_required")?.data.message).toBe("Explain the thesis");
    await saveOpen(ctx.owner.h, b.id, { thesis: "A much richer thesis" });
    expect((await submitBasket(ctx.owner.h, b.id)).status).toBe(200);
    expect((await versionRow(b.vid)).status).toBe("in_review");
  });

  it("escalation needs an internal note, leaves the version in review and cannot be withdrawn after another decision", async () => {
    const b = await ready();
    await submitBasket(ctx.owner.h, b.id);
    expect((await decideBasket(reviewer.h, b.id, b.vid, decision("escalated"))).status).toBe(400);
    const res = await decideBasket(reviewer.h, b.id, b.vid, decision("escalated", { internalNote: "Needs an admin" }));
    expect(res.status).toBe(200);
    expect((await versionRow(b.vid)).status).toBe("in_review");
    const queues = async (q: string) => (await request(app).get(`/v1/ops/baskets?queue=${q}`).set(reviewer.h)).body.items.map((i: { id: string }) => i.id);
    expect(await queues("escalated")).toContain(b.id);
    expect(await queues("review")).not.toContain(b.id);
    expect((await post(ctx.owner.h, `/v1/baskets/${b.id}/withdraw`)).status).toBe(200);
    // A second submission, reviewed with a real decision, can no longer be withdrawn (it is no longer in review at all).
    await submitBasket(ctx.owner.h, b.id);
    await decideBasket(reviewer.h, b.id, b.vid, decision("changes_required", { messageToManager: "Fix" }));
    expect((await post(ctx.owner.h, `/v1/baskets/${b.id}/withdraw`)).status).toBe(409);
  });

  it("rejecting version 1 rejects the basket; it can no longer be edited", async () => {
    const b = await ready();
    await submitBasket(ctx.owner.h, b.id);
    const res = await decideBasket(reviewer.h, b.id, b.vid, decision("rejected", { messageToManager: "Not a fit" }));
    expect(res.status).toBe(200);
    expect(await basketRow(b.id)).toMatchObject({ status: "REJECTED" });
    expect((await versionRow(b.vid)).status).toBe("rejected");
    expect(await eventKinds(b.id)).toContain("rejected");
    expect(fakes.email.basket.map((e) => e.kind)).toContain("rejected");
    expect((await submitBasket(ctx.owner.h, b.id)).status).toBe(409);
  });

  it("blocks an ops user who belongs to the organization, and users without an ops role", async () => {
    const b = await ready();
    await submitBasket(ctx.owner.h, b.id);
    const insider = await opsUser(app, "ops_admin");
    await adminSql`INSERT INTO app.organization_memberships (id, organization_id, user_id, role, status) VALUES (gen_random_uuid(), ${ctx.owner.id}, ${insider.userId}, 'VIEWER', 'REVOKED')`;
    const res = await decideBasket(insider.h, b.id, b.vid, decision("approved"));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("You can't review your own organization.");
    expect((await decideBasket((await user(app, false)).h, b.id, b.vid, decision("approved"))).status).toBe(403);
    expect((await versionRow(b.vid)).status).toBe("in_review");
  });

  it("lists the review queue and shows ops the snapshot, reviews and context", async () => {
    const b = await ready();
    await submitBasket(ctx.owner.h, b.id);
    const list = await request(app).get("/v1/ops/baskets?queue=review").set(reviewer.h);
    expect(list.body.items.find((i: { id: string }) => i.id === b.id)).toMatchObject({ name: "Core Crypto", latestVersionNumber: 1, latestVersionStatus: "in_review", status: "DRAFT" });
    const detail = await opsGet(reviewer.h, b.id);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ organization: { id: ctx.owner.id, status: "VERIFIED" }, openVersion: { status: "in_review" }, validation: { issues: [] }, diff: { added: expect.any(Array) } });
    expect((await request(app).get("/v1/ops/baskets?queue=nope").set(reviewer.h)).status).toBe(400);
    expect((await request(app).get(`/v1/ops/baskets/${b.id}`).set(ctx.owner.h)).status).toBe(403);
  });
});

describe("review rounds", () => {
  const queues = async (q: string) => (await request(app).get(`/v1/ops/baskets?queue=${q}`).set(reviewer.h)).body.items.map((i: { id: string }) => i.id);

  it("an earlier round's review does not block withdrawing the resubmission", async () => {
    const b = await ready();
    await submitBasket(ctx.owner.h, b.id);
    await decideBasket(reviewer.h, b.id, b.vid, decision("changes_required", { messageToManager: "Fix" }));
    await saveOpen(ctx.owner.h, b.id, { thesis: "Better thesis" });
    await submitBasket(ctx.owner.h, b.id);
    expect((await post(ctx.owner.h, `/v1/baskets/${b.id}/withdraw`)).status).toBe(200);
  });

  it("an escalation of an earlier round does not keep the resubmission in the escalated queue", async () => {
    const b = await ready();
    await submitBasket(ctx.owner.h, b.id);
    await decideBasket(reviewer.h, b.id, b.vid, decision("escalated", { internalNote: "Admin please" }));
    await post(ctx.owner.h, `/v1/baskets/${b.id}/withdraw`);
    await submitBasket(ctx.owner.h, b.id);
    expect(await queues("review")).toContain(b.id);
    expect(await queues("escalated")).not.toContain(b.id);
  });

  it("a retired basket is read-only for decisions and withdrawal and leaves the queues", async () => {
    const b = await ready();
    await submitBasket(ctx.owner.h, b.id);
    expect(await queues("review")).toContain(b.id);
    await adminSql`UPDATE app.baskets SET status = 'RETIRED' WHERE id = ${b.id}`;
    expect(await queues("review")).not.toContain(b.id);
    expect((await decideBasket(admin.h, b.id, b.vid, decision("approved"))).status).toBe(409);
    expect((await post(ctx.owner.h, `/v1/baskets/${b.id}/withdraw`)).status).toBe(409);
  });
});
