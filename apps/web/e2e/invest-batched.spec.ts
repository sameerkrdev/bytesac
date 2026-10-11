/**
 * Batched invest against the mock API (never real wallets or funds). Needs the web dev server and the mock API:
 *   pnpm --filter web dev  and  pnpm --filter web mock-api
 *   pnpm --filter web exec playwright test e2e/invest-batched.spec.ts
 * The browser has no wallet extension, so these stop where the wallet would open; the wallet calls and the submit are covered by test/group-flow.test.tsx.
 */
import { expect, test } from "@playwright/test";
import type { GroupResponse, OperationView } from "@repo/validator";
import { BASKETS } from "./mock-api/catalog";
import { investPlan, portfolioFor } from "./mock-api/portfolio";

const base = "http://localhost:3000";
test.use({ baseURL: base, viewport: { width: 1440, height: 900 } });
test.beforeEach(async ({ context }) => context.addCookies([{ name: "bx_session", value: "mock-investor", url: base }]));

const seed = BASKETS[0]!;
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const groupFor = (op: OperationView): GroupResponse => ({
  groupId: "0192f1c2-7a4b-7c3d-8e9f-0000000009a1", status: "quoted", expiresAt: new Date(Date.now() + 60_000).toISOString(), sendBy: new Date(Date.now() + 40_000).toISOString(),
  priceMoved: false, approvalsEstimate: 1, solRequiredLamports: "5200000",
  transactions: op.legs.filter((l) => l.status === "PLANNED").map((l) => ({ legId: l.id, kind: l.kind === "network_fee" ? "fee" : "asset", serializedBase64: "AAEC" })), legs: [],
});

test("happy path: the review shows the estimates, and Confirm asks for a sign_all group", async ({ page }) => {
  const groups: unknown[] = [];
  await page.route("**/api/v1/operations/*/groups", async (route) => {
    groups.push(route.request().postDataJSON());
    await route.fulfill(json(groupFor(investPlan(seed, seed.minimum, 100))));
  });
  await page.goto(`/baskets/${seed.slug}/invest`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Get preview" }).click();
  await expect(page.getByText("About 1 wallet approval")).toBeVisible();
  await expect(page.getByText(/Network fees: about 0\.0042 SOL, paid by you in SOL/)).toBeVisible();
  await expect(page.getByText(/batches you never send aren.t charged/)).toBeVisible();
  expect(groups).toHaveLength(0); // nothing is quoted on the review step
  await page.getByRole("checkbox", { name: /I.ll approve these transactions/ }).check();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { name: "Approve in your wallet" })).toBeVisible();
  await expect.poll(() => groups.length).toBe(1);
  expect(groups[0]).toMatchObject({ chain: "solana", tier: "sign_all" });
});

test("partial: the open investment can be continued from the portfolio", async ({ page }) => {
  const plan = investPlan(seed, "300", 100);
  const last = plan.legs.length - 1;
  const stopped: OperationView = {
    ...plan, status: "IN_PROGRESS", needsAction: true, needsActionSince: new Date(Date.now() - 3_600_000).toISOString(),
    legs: plan.legs.map((l, i) => (i === last ? { ...l, status: "PLANNED", lastError: "QUOTE_STALE" } : { ...l, status: "SETTLED", sourceTx: "5xmock" })),
  };
  const continued: unknown[] = [];
  const groups: unknown[] = [];
  await page.route("**/api/v1/portfolio", (route) => route.fulfill(json({ ...portfolioFor("investor"), openOperations: [stopped] })));
  await page.route("**/api/v1/operations/*", (route) => (route.request().method() === "GET" ? route.fulfill(json(stopped)) : route.fallback()));
  await page.route("**/api/v1/operations/*/continue", async (route) => {
    continued.push(route.request().postDataJSON());
    await route.fulfill(json({ ...stopped, needsAction: false, needsActionSince: null }));
  });
  await page.route("**/api/v1/operations/*/groups", async (route) => {
    groups.push(route.request().postDataJSON());
    await route.fulfill(json(groupFor({ ...stopped, needsAction: false })));
  });

  await page.goto("/portfolio", { waitUntil: "networkidle" });
  const card = page.locator(`#operation-${plan.id}`);
  await card.getByRole("button", { name: "Continue", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Quote expired before sending — nothing spent")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(dialog.getByText(/Continue is free until .*; stopping keeps fees already paid\./)).toBeVisible();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => continued.length).toBe(1);
  expect(continued[0]).toMatchObject({ idempotencyKey: expect.any(String) });
  await expect.poll(() => groups.length).toBe(1);
  expect(groups[0]).toMatchObject({ chain: "solana", tier: "sign_all" });
});
