"use client";

import { useAppKitConnection, type Provider as SolanaProvider } from "@reown/appkit-adapter-solana/react";
import { solana, solanaDevnet } from "@reown/appkit/networks";
import { useAppKit, useAppKitAccount, useAppKitNetwork, useWalletInfo } from "@reown/appkit/react";
import { Connection, PublicKey, type VersionedTransaction } from "@solana/web3.js";
import { arbitrum, base, bsc, mainnet, polygon } from "viem/chains";
import { useEffect, useMemo, useState } from "react";
import { useConfig } from "wagmi";
import { getAccount, getCapabilities, getTransaction, sendCalls, switchChain, waitForCallsStatus } from "wagmi/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Callout, Eyebrow, Tile } from "@/components/ui/kit";
import { appKit } from "@/lib/appkit";
import { standardWallets } from "@/lib/wallet/standard-wallets";
import { buildMemoBatch, classifyWalletError, compareSigned, failureDetail, LAB_BATCH_SIZES, revertVerdict, scrubAddresses, sendPlan, USDC_BY_CHAIN, type LabResult } from "@/lib/wallet-lab";

/** Dev-only (Spec 22 P0): measures how each wallet handles batched signing. It builds harmless transactions and sends nothing unless a button says so. */

const EVM_CHAINS = { base, arbitrum, polygon, ethereum: mainnet, bnb: bsc } as const;
type EvmChain = keyof typeof EVM_CHAINS;

/** The Wallet Standard `solana:signAndSendTransaction` feature, reached through the AppKit provider's wallet (announced wallets only). */
type SignAndSendFeature = { signAndSendTransaction: (...inputs: { account: unknown; chain: string; transaction: Uint8Array }[]) => Promise<{ signature: Uint8Array }[]> };
type StandardBacked = { wallet?: { features: Record<string, unknown>; accounts: readonly { address: string }[] } };

type SignedRun = { signed: VersionedTransaction[]; builtAt: number; row: number };

export function WalletLab() {
  const { open } = useAppKit();
  const { connection } = useAppKitConnection();
  const config = useConfig();
  const sol = useAppKitAccount({ namespace: "solana" });
  const evm = useAppKitAccount({ namespace: "eip155" });
  const solName = useWalletInfo("solana").walletInfo?.name ?? "unknown";
  useAppKitNetwork(); // re-render when the active network changes
  const devnet = appKit.getCaipNetwork("solana")?.id === solanaDevnet.id;
  /** Devnet runs use the public devnet RPC (free faucet SOL); mainnet keeps AppKit's connection. The Wallet Standard chain follows. */
  const devnetRpc = useMemo(() => new Connection("https://api.devnet.solana.com", "confirmed"), []);
  const rpc = devnet ? devnetRpc : connection;
  const standardChain = devnet ? "solana:devnet" : "solana:mainnet";
  const evmName = useWalletInfo("eip155").walletInfo?.name ?? "unknown";

  const [std, setStd] = useState<{ name: string; features: string[] }[]>([]);
  const [n, setN] = useState<number>(12);
  const [chain, setChain] = useState<EvmChain>("base");
  const [rows, setRows] = useState<LabResult[]>([]);
  const [last, setLast] = useState<SignedRun | null>(null);
  const [sendEnabled, setSendEnabled] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void standardWallets().then((ws) => setStd(ws.map((w) => ({ name: w.name, features: Object.keys(w.features) })))); }, [sol.address]);

  const patch = (row: number, p: Partial<LabResult>) => setRows((prev) => prev.map((r, k) => (k === row ? { ...r, ...p } : r)));

  /** One run: wallet errors become a row (`rejected` / `unsupported` / `error`), never a crash. `run` returns the wallet-call time and any extra fields. */
  const attempt = async (head: Pick<LabResult, "family" | "wallet" | "mode" | "chain" | "n">, run: () => Promise<Partial<LabResult>>) => {
    setBusy(true);
    setNote("");
    setLast(null);
    try {
      const extra = await run();
      setRows((prev) => [...prev, { ...head, msToReturn: null, popupsReported: null, ...extra, outcome: "ok" }]);
    } catch (err) {
      const [outcome, detail] = [classifyWalletError(err), failureDetail(err)];
      setNote(`${outcome}: ${detail}`);
      setRows((prev) => [...prev, { ...head, outcome, detail, msToReturn: null, popupsReported: null }]);
    } finally {
      setBusy(false);
    }
  };

  const runSolana = (mode: "sign_all" | "single" | "sign_and_send") => attempt({ family: "solana", wallet: solName, mode, chain: "solana", n }, async () => {
    const provider = appKit.getProvider<SolanaProvider & StandardBacked>("solana");
    const address = appKit.getAddress("solana");
    if (!provider || !address || !rpc) throw new Error("Connect a Solana wallet first");
    const { blockhash } = await rpc.getLatestBlockhash("confirmed");
    const txs = buildMemoBatch({ payer: new PublicKey(address), blockhash, n, runId: Date.now().toString(36) });
    const builtAt = Date.now();
    const t0 = performance.now();
    if (mode === "sign_and_send") {
      const feature = provider.wallet?.features["solana:signAndSendTransaction"] as SignAndSendFeature | undefined;
      const account = provider.wallet?.accounts.find((a) => a.address === address);
      if (!feature || !account) throw new Error("solana:signAndSendTransaction is not supported by this wallet");
      const out = await feature.signAndSendTransaction(...txs.map((tx) => ({ account, chain: standardChain, transaction: tx.serialize() })));
      return { msToReturn: Math.round(performance.now() - t0), sent: { ok: out.length, expired: 0, failed: n - out.length } };
    }
    let signed: VersionedTransaction[] = [];
    if (mode === "sign_all") signed = await provider.signAllTransactions(txs);
    else for (const tx of txs) signed.push(await provider.signTransaction(tx));
    const msToReturn = Math.round(performance.now() - t0);
    setLast({ signed, builtAt, row: rows.length });
    return { msToReturn, compare: compareSigned(txs, signed) };
  });

  /** Broadcasts the last signed batch, skipping every transaction from the first stale blockhash on. */
  const sendSigned = async () => {
    if (!last || !rpc) return;
    setBusy(true);
    try {
      const valid = await Promise.all(last.signed.map(async (tx) => (await rpc.isBlockhashValid(tx.message.recentBlockhash, { commitment: "confirmed" })).value));
      const plan = sendPlan({ builtAt: last.builtAt, now: Date.now(), valid });
      const sent = { ok: 0, expired: 0, failed: 0 };
      let lastError = "";
      for (const [k, tx] of last.signed.entries()) {
        if (plan[k] === "expired") { sent.expired++; continue; }
        try { await rpc.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 0 }); sent.ok++; } catch (err) { sent.failed++; lastError = failureDetail(err); }
      }
      patch(last.row, { sent });
      setNote(`Sent ${Math.round((Date.now() - last.builtAt) / 1000)} s after building: ${sent.ok} accepted by the RPC (not necessarily landed), ${sent.expired} expired, ${sent.failed} failed${lastError ? ` (${lastError})` : ""}.`);
      setLast(null);
    } catch (err) {
      setNote(`error: ${failureDetail(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const runEvm = (kind: "capabilities" | "calls" | "revert") => attempt({ family: "evm", wallet: evmName, mode: "evm_calls", chain, n: kind === "capabilities" ? 0 : kind === "revert" ? 3 : n }, async () => {
    const account = evm.address as `0x${string}` | undefined;
    if (!account) throw new Error("Connect an EVM wallet first");
    const chainId = EVM_CHAINS[chain].id;
    let capabilities: unknown;
    try {
      capabilities = await getCapabilities(config, { account, chainId });
    } catch (err) {
      if (kind === "capabilities") throw err;
      capabilities = { error: classifyWalletError(err) };
    }
    if (kind === "capabilities") return { evm: { capabilities, receipts: 0, distinctTxTo: 0, atomic: null, statusCode: null, revertedCall: "n/a" } };
    // A harmless zero-value call: USDC `decimals()` changes no state. (MetaMask refuses empty call data "0x", so a plain self-call does not work.)
    const harmless = { to: USDC_BY_CHAIN[chain], value: 0n, data: "0x313ce567" } as const;
    const calls: { to: `0x${string}`; value?: bigint; data: `0x${string}` }[] = kind === "revert" ? [harmless, { to: USDC_BY_CHAIN[chain], data: "0xdeadbeef" }, harmless] : Array.from({ length: n }, () => harmless);
    // Some wallets (MetaMask) accept a batch only for the network the site has selected: switch first. The switch moves no funds.
    if (getAccount(config).chainId !== chainId) await switchChain(config, { chainId });
    const t0 = performance.now();
    const { id } = await sendCalls(config, { calls, chainId }); // viem sends atomicRequired: false unless forceAtomic is set
    const msToReturn = Math.round(performance.now() - t0);
    const status = await waitForCallsStatus(config, { id, timeout: 120_000 });
    const receipts = status.receipts ?? [];
    const txs = await Promise.all(receipts.map((r) => getTransaction(config, { hash: r.transactionHash, chainId })));
    const selfTo = txs.filter((t) => t.to?.toLowerCase() === account.toLowerCase()).length;
    setNote(`status ${status.status} (${status.statusCode}, ${status.atomic ? "atomic" : "not atomic"}); receipts ${receipts.map((r) => r.status).join(",") || "none"}; ${selfTo} of ${txs.length} transactions are sent to your own address (EIP-7702 style).`);
    return { msToReturn, evm: { capabilities, receipts: receipts.length, distinctTxTo: new Set(txs.map((t) => t.to?.toLowerCase())).size, atomic: status.atomic, statusCode: status.statusCode, revertedCall: kind === "revert" ? revertVerdict({ statusCode: status.statusCode, atomic: status.atomic, receipts: receipts.length, calls: calls.length }) : "n/a" } };
  });

  const copyJson = () => navigator.clipboard.writeText(scrubAddresses(JSON.stringify(rows, null, 2))).then(() => setNote("Copied."), () => setNote("Clipboard blocked; select the table instead."));
  const lastRow = rows.at(-1);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <header>
        <Eyebrow>Spec 22 P0 · dev only</Eyebrow>
        <h1 className="text-2xl font-semibold text-ink">Wallet batch-signing lab</h1>
      </header>

      <Tile className="space-y-3">
        <Eyebrow as="h2">Connected wallets</Eyebrow>
        <Button onClick={() => open()}>Connect or switch wallet</Button>
        <p className="text-sm text-ink-muted">Solana: {sol.isConnected ? solName : "not connected"} · EVM: {evm.isConnected ? evmName : "not connected"}</p>
        <label className="block text-sm font-medium text-ink"><input type="checkbox" checked={sendEnabled} onChange={(e) => setSendEnabled(e.target.checked)} /> Allow anything that broadcasts (off by default: sign-and-send, send signed, EVM calls)</label>
        <ul className="text-sm text-ink-muted">
          {std.map((w, k) => <li key={`${w.name}-${k}`}><b>{w.name}</b>: {w.features.join(", ")}</li>)}
          {std.length === 0 && <li>No Wallet Standard wallets announced.</li>}
        </ul>
      </Tile>

      <Tile className="space-y-3">
        <Eyebrow as="h2">Batch size</Eyebrow>
        <Select aria-label="Batch size" value={n} onChange={(e) => setN(Number(e.target.value))}>
          {LAB_BATCH_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
        </Select>
      </Tile>

      <Tile className="space-y-3">
        <Eyebrow as="h2">Solana</Eyebrow>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-muted">Solana network: <b>{devnet ? "Devnet" : "Mainnet"}</b></span>
          <Button size="sm" variant="secondary" disabled={busy || !devnet} onClick={() => appKit.switchNetwork(solana)}>Use mainnet</Button>
          <Button size="sm" variant="secondary" disabled={busy || devnet} onClick={() => appKit.switchNetwork(solanaDevnet)}>Use devnet</Button>
        </div>
        {devnet && <Callout tone="info">Devnet: free SOL from faucet.solana.com. Switch the wallet to devnet too (Phantom: Settings → Developer settings → Testnet mode; Solflare: Settings → Network; MetaMask: show test networks).</Callout>}
        <p className="text-sm text-ink-muted">Memo-only transactions, you as fee payer. Signing is free. Sending costs at least {n} × 0.000005 SOL (more if the wallet adds a priority fee).</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => runSolana("sign_all")}>Sign all</Button>
          <Button disabled={busy} variant="secondary" onClick={() => runSolana("single")}>Sign one by one</Button>
          <Button disabled={busy || !sendEnabled} variant="secondary" onClick={() => runSolana("sign_and_send")}>Sign and send (Wallet Standard), sends now: at least {n} × 0.000005 SOL; rejecting mid-batch leaves earlier ones sent</Button>
        </div>
        {lastRow?.family === "solana" && (
          <label className="block text-sm">How many popups did you see?{" "}
            <input type="number" min={0} className="w-20 rounded border border-line-strong bg-surface px-2 py-1" value={lastRow.popupsReported ?? ""} onChange={(e) => patch(rows.length - 1, { popupsReported: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
        )}
        <Button disabled={busy || !sendEnabled || !last} variant="destructive" onClick={sendSigned}>Send signed (at least {last?.signed.length ?? 0} × 0.000005 SOL)</Button>
      </Tile>

      <Tile className="space-y-3">
        <Eyebrow as="h2">EVM (EIP-5792)</Eyebrow>
        <Select aria-label="Chain" value={chain} onChange={(e) => setChain(e.target.value as EvmChain)}>
          {Object.keys(EVM_CHAINS).map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        {chain === "ethereum" && <Callout tone="warning">Ethereum gas is expensive; prefer Base, Arbitrum or Polygon.</Callout>}
        <p className="text-sm text-ink-muted">Zero-value harmless calls (USDC decimals()): up to {n} calls on {chain}, gas from your wallet. Sends are off on Ethereum (capabilities only).</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} variant="secondary" onClick={() => runEvm("capabilities")}>Capabilities</Button>
          <Button disabled={busy || !sendEnabled || chain === "ethereum"} onClick={() => runEvm("calls")}>Send {n} harmless calls</Button>
          <Button disabled={busy || !sendEnabled || chain === "ethereum"} variant="secondary" onClick={() => runEvm("revert")}>Send with a reverting call (3 calls)</Button>
        </div>
      </Tile>

      {note && <Callout tone="info">{note}</Callout>}

      <Tile className="space-y-3">
        <Eyebrow as="h2">Results</Eyebrow>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr><th>Wallet</th><th>Mode</th><th>Chain</th><th>n</th><th>Outcome</th><th>ms</th><th>Popups</th><th>Detail</th></tr></thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={k}>
                  <td>{r.wallet}</td><td>{r.mode}</td><td>{r.chain}</td><td>{r.n}</td><td>{r.outcome}</td><td>{r.msToReturn ?? "-"}</td><td>{r.popupsReported ?? "-"}</td>
                  <td>{[r.compare && `${r.compare.count}/${r.compare.expected} back, ${r.compare.inOrder ? "in order" : "reordered"}, ${r.compare.rewritten} rewritten${r.compare.rewritten && r.compare.onlyComputeBudget ? " (ComputeBudget only)" : ""}${r.compare.blockhashChanged ? ", BLOCKHASH CHANGED" : ""}${r.compare.feePayerChanged ? ", FEE PAYER CHANGED" : ""}${r.compare.unsigned ? `, ${r.compare.unsigned} UNSIGNED` : ""}`, r.sent && `sent ${r.sent.ok} ok / ${r.sent.expired} expired / ${r.sent.failed} failed`, r.evm && `${r.evm.receipts} receipts, ${r.evm.distinctTxTo} distinct to, ${r.evm.atomic === null ? "" : r.evm.atomic ? "atomic, " : "not atomic, "}revert: ${r.evm.revertedCall}`, r.detail].filter(Boolean).join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="secondary" disabled={rows.length === 0} onClick={copyJson}>Copy JSON</Button>
        <p className="text-sm text-ink-muted">Addresses are scrubbed from the copy. Paste into INTEGRATION-AUDIT.md §Batch signing (P0).</p>
      </Tile>
    </main>
  );
}
