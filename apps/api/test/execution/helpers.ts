import { randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { RawTx, Script, Transaction, p2sh, p2tr, p2wpkh } from "@scure/btc-signer";
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
export async function seedUser(over: { email?: boolean; phone?: boolean; evm?: boolean; bitcoin?: boolean; wallet?: { address: string; sign(message: string): string | Promise<string> } } = {}) {
  const solana = over.wallet ?? newSolanaWallet();
  const s = await signIn(app, solana, "solana");
  const [w] = await adminSql<{ id: string }[]>`SELECT id FROM app.investment_wallets WHERE user_id = ${s.userId}`;
  const evmAddress = newEvmWallet().address.toLowerCase();
  const btcAddress = bitcoinWallet("p2wpkh").address;
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

// ---------------------------------------------------------------------------------------------------------------------
// Bitcoin test wallets (throwaway keys generated per test; nothing is broadcast)
// ---------------------------------------------------------------------------------------------------------------------

export type BtcKind = "p2wpkh" | "p2tr" | "p2sh-p2wpkh";

export function bitcoinWallet(kind: BtcKind = "p2wpkh") {
  const priv = secp256k1.utils.randomSecretKey();
  const pub = secp256k1.getPublicKey(priv, true);
  const pay = kind === "p2tr" ? p2tr(pub.subarray(1)) : kind === "p2sh-p2wpkh" ? p2sh(p2wpkh(pub)) : p2wpkh(pub);
  return { kind, priv, pub, pay, address: pay.address! };
}

const enc = new TextEncoder();
const concatBytes = (...p: Uint8Array[]) => Uint8Array.from(p.flatMap((x) => [...x]));

/** The BIP-322 `to_sign` PSBT for `message`, signed by `w` (what a wallet's `signPSBT` returns), base64. */
export function bip322Psbt(w: ReturnType<typeof bitcoinWallet>, message: string): string {
  const tag = sha256(enc.encode("BIP0322-signed-message"));
  const messageHash = sha256(concatBytes(tag, tag, enc.encode(message)));
  const toSpend = RawTx.encode({
    version: 0, lockTime: 0, segwitFlag: false, witnesses: [], outputs: [{ amount: 0n, script: w.pay.script }],
    inputs: [{ txid: new Uint8Array(32), index: 0xffffffff, finalScriptSig: Script.encode(["OP_0", messageHash]), sequence: 0 }],
  });
  const tx = new Transaction({ version: 0, allowUnknownOutputs: true });
  tx.addInput({
    txid: sha256(sha256(toSpend)).reverse(), index: 0, sequence: 0, witnessUtxo: { script: w.pay.script, amount: 0n },
    ...(w.kind === "p2tr" ? { tapInternalKey: w.pub.subarray(1) } : {}),
    ...(w.kind === "p2sh-p2wpkh" ? { redeemScript: p2wpkh(w.pub).script } : {}),
  });
  tx.addOutput({ script: Script.encode(["RETURN"]), amount: 0n });
  tx.sign(w.priv);
  return Buffer.from(tx.toPSBT()).toString("base64");
}

/** A BIP-137 compact signature (base64) with the header for `w`'s address type. */
export function bip137Signature(w: ReturnType<typeof bitcoinWallet>, message: string): string {
  const body = enc.encode(message);
  const digest = sha256(sha256(concatBytes(enc.encode("\x18Bitcoin Signed Message:\n"), body.length < 0xfd ? Uint8Array.of(body.length) : Uint8Array.of(0xfd, body.length & 0xff, body.length >> 8), body)));
  const rec = secp256k1.sign(digest, w.priv, { prehash: false, format: "recovered" }); // [recovery, r, s]
  const header = (w.kind === "p2sh-p2wpkh" ? 35 : 39) + rec[0]!;
  return Buffer.from(concatBytes(Uint8Array.of(header), rec.subarray(1))).toString("base64");
}

/** A position in `basket` holding `holdings` (raw base units per deployment), inserted directly with its ledger. */
export async function seedPosition(userId: string, basket: { basketId: string; versionId: string }, holdings: { deploymentId: string; quantity: bigint }[], status: "OPEN" | "CLOSED" = "OPEN") {
  const [p] = await adminSql<{ id: string }[]>`
    INSERT INTO app.basket_positions (id, user_id, basket_id, status, applied_version_id, closed_at)
    VALUES (gen_random_uuid(), ${userId}, ${basket.basketId}, ${status}, ${basket.versionId}, ${status === "CLOSED" ? adminSql`now()` : null}) RETURNING id`;
  for (const h of holdings) {
    const { legId, operationId } = await seedLeg(userId, basket, { kind: "swap", fromChain: "solana", toChain: "solana" });
    await adminSql`INSERT INTO app.position_ledger_entries (id, position_id, deployment_id, quantity_delta, reason, leg_id) VALUES (gen_random_uuid(), ${p!.id}, ${h.deploymentId}, ${h.quantity.toString()}, 'invest', ${legId})`;
    await adminSql`UPDATE app.operations SET status = 'COMPLETED' WHERE id = ${operationId}`;
  }
  return p!.id;
}

/** An operation (PLANNED) with one network-fee-style leg for `userId`, inserted directly; returns the ids. */
export async function seedLeg(userId: string, basket: { basketId: string; versionId: string }, over: { fromChain?: string; toChain?: string; kind?: string } = {}) {
  const [op] = await adminSql<{ id: string }[]>`
    INSERT INTO app.operations (id, user_id, basket_id, kind, status, slippage_bps, network_fee_usdc, version_id, idempotency_key, expires_at)
    VALUES (gen_random_uuid(), ${userId}, ${basket.basketId}, 'invest', 'PLANNED', 100, 10000, ${basket.versionId}, ${"key-" + randomBytes(6).toString("hex")}, now() + interval '30 minutes') RETURNING id`;
  const [leg] = await adminSql<{ id: string }[]>`
    INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, to_chain, amount_in)
    VALUES (gen_random_uuid(), ${op!.id}, 1, ${over.kind ?? "swap"}, ${over.fromChain ?? "ethereum"}, ${over.toChain ?? "solana"}, 1000000) RETURNING id`;
  return { operationId: op!.id, legId: leg!.id };
}
