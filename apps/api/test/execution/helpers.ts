import { randomBytes } from "node:crypto";
import { app } from "../../src/app";
import { signIn, webHeaders } from "../helpers/auth";
import { adminSql } from "../helpers/db";
import { newEvmWallet, newSolanaWallet } from "../helpers/wallets";
import { orgWithOwner } from "../members/helpers";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface SeedAsset {
  symbol: string;
  chain: "solana" | "ethereum" | "base" | "bitcoin";
  tokenStandard?: "native" | "erc20" | "spl";
  decimals?: number;
  bps: number;
  assetType?: string;
  /** Skip the route (no execution route). */
  noRoute?: boolean;
  providerName?: string;
}

const addressFor = (chain: SeedAsset["chain"]) => (chain === "solana" ? newSolanaWallet().address : "0x" + randomBytes(20).toString("hex"));

/** An ACTIVE basket (published version, `assets` as constituents) with ACTIVE instruments, deployments and LI.FI routes, inserted directly. */
export async function seedBasket(over: { assets: SeedAsset[]; status?: string; minimum?: string; slug?: string }) {
  const owner = await orgWithOwner(app);
  const [provider] = await adminSql<{ id: string }[]>`INSERT INTO app.asset_providers (id, name, kind) VALUES (gen_random_uuid(), 'LI.FI', 'dex_aggregator') ON CONFLICT (name) DO UPDATE SET name = excluded.name RETURNING id`;
  const [basket] = await adminSql<{ id: string; slug: string }[]>`
    INSERT INTO app.baskets (id, organization_id, slug, status, created_by_user_id)
    VALUES (gen_random_uuid(), ${owner.id}, ${over.slug ?? "basket-" + randomBytes(3).toString("hex")}, ${over.status ?? "ACTIVE"}, ${owner.userId}) RETURNING id, slug`;
  const [version] = await adminSql<{ id: string }[]>`
    INSERT INTO app.basket_versions (id, basket_id, version_number, status, name, category, fees, minimum_investment_usdc, assets_revision, created_by_user_id, published_at)
    VALUES (gen_random_uuid(), ${basket!.id}, 1, 'published', 'Test basket', 'multi_asset', ${adminSql.json({})}, ${over.minimum ?? "100"}, 1, ${owner.userId}, now()) RETURNING id`;
  await adminSql`UPDATE app.baskets SET current_version_id = ${version!.id} WHERE id = ${basket!.id}`;
  const deployments: { instrumentId: string; deploymentId: string; chain: string; address: string | null; decimals: number; bps: number; symbol: string }[] = [];
  for (const a of over.assets) {
    const native = a.tokenStandard ? a.tokenStandard === "native" : a.chain === "bitcoin";
    const standard = a.tokenStandard ?? (native ? "native" : a.chain === "solana" ? "spl" : "erc20");
    const address = native ? null : addressFor(a.chain);
    const decimals = a.decimals ?? (a.chain === "bitcoin" ? 8 : a.chain === "solana" ? 9 : 18);
    const [i] = await adminSql<{ id: string }[]>`
      INSERT INTO app.instruments (id, name, symbol, asset_type, status, created_by_user_id)
      VALUES (gen_random_uuid(), ${a.symbol}, ${a.symbol}, ${a.assetType ?? "CRYPTO"}, 'ACTIVE', ${owner.userId}) RETURNING id`;
    const [d] = await adminSql<{ id: string }[]>`
      INSERT INTO app.instrument_deployments (id, instrument_id, chain, token_standard, address, decimals, verification, status)
      VALUES (gen_random_uuid(), ${i!.id}, ${a.chain}, ${standard}, ${address}, ${decimals}, 'manual', 'ACTIVE') RETURNING id`;
    if (!a.noRoute) {
      const providerId = a.providerName
        ? (await adminSql<{ id: string }[]>`INSERT INTO app.asset_providers (id, name, kind) VALUES (gen_random_uuid(), ${a.providerName}, 'other') ON CONFLICT (name) DO UPDATE SET name = excluded.name RETURNING id`)[0]!.id
        : provider!.id;
      await adminSql`INSERT INTO app.execution_routes (id, instrument_id, deployment_id, provider_id, venue, method, processing_model, status)
        VALUES (gen_random_uuid(), ${i!.id}, ${d!.id}, ${providerId}, 'LI.FI', 'swap', 'sync', 'ACTIVE')`;
    }
    await adminSql`INSERT INTO app.basket_version_assets (id, version_id, revision, instrument_id, target_weight_bps) VALUES (gen_random_uuid(), ${version!.id}, 1, ${i!.id}, ${a.bps})`;
    deployments.push({ instrumentId: i!.id, deploymentId: d!.id, chain: a.chain, address, decimals, bps: a.bps, symbol: a.symbol });
  }
  return { basketId: basket!.id, slug: basket!.slug, versionId: version!.id, deployments, ownerId: owner.userId };
}

/** A signed-in user (Solana investment wallet) with optional verified contacts and extra linked families, inserted directly. */
export async function seedUser(over: { email?: boolean; phone?: boolean; evm?: boolean; bitcoin?: boolean } = {}) {
  const solana = newSolanaWallet();
  const s = await signIn(app, solana, "solana");
  const [w] = await adminSql<{ id: string }[]>`SELECT id FROM app.investment_wallets WHERE user_id = ${s.userId}`;
  const evmAddress = newEvmWallet().address.toLowerCase();
  const btcAddress = "bc1q" + randomBytes(16).toString("hex").slice(0, 38);
  if (over.email ?? true) await adminSql`INSERT INTO app.contacts (id, user_id, type, value, status, verified_at) VALUES (gen_random_uuid(), ${s.userId}, 'email', ${`u-${s.userId.slice(0, 8)}@example.com`}, 'verified', now())`;
  if (over.phone ?? true) await adminSql`INSERT INTO app.contacts (id, user_id, type, value, status, verified_at) VALUES (gen_random_uuid(), ${s.userId}, 'phone', ${"+4477009" + Math.floor(Math.random() * 90000 + 10000)}, 'verified', now())`;
  if (over.evm ?? true) {
    await adminSql`INSERT INTO app.wallet_addresses (id, investment_wallet_id, chain_family, chain, address, verification_method, verified_on_chain)
      VALUES (gen_random_uuid(), ${w!.id}, 'evm', 'ethereum', ${evmAddress}, 'eoa_ecdsa', 'ethereum')`;
  }
  if (over.bitcoin) {
    await adminSql`INSERT INTO app.wallet_addresses (id, investment_wallet_id, chain_family, chain, address, verification_method, verified_on_chain)
      VALUES (gen_random_uuid(), ${w!.id}, 'bitcoin', 'bitcoin', ${btcAddress}, 'bip322', 'bitcoin')`;
  }
  return { userId: s.userId, h: webHeaders(s.cookie), solanaAddress: solana.address, evmAddress, btcAddress };
}
