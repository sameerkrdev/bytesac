/** Decimal text to raw units, or null when it is not a number with at most `decimals` places. */
export const toRaw = (text: string, decimals: number): bigint | null => {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  return !m || (m[2]?.length ?? 0) > decimals ? null : BigInt(m[1]! + (m[2] ?? "").padEnd(decimals, "0"));
};

/** Each entry must parse and not exceed its ledger quantity, and together they must equal the shortfall exactly. `raw` is the parsed split (null where invalid). */
export function validateSyncSplit(texts: string[], ledgers: string[], totalShortfall: string, decimals: number): { raw: (bigint | null)[]; sum: bigint; total: bigint; valid: boolean } {
  const raw = texts.map((t) => toRaw(t, decimals));
  const sum = raw.reduce<bigint>((s, v) => s + (v ?? 0n), 0n);
  const total = BigInt(totalShortfall);
  return { raw, sum, total, valid: raw.every((v, n) => v !== null && v <= BigInt(ledgers[n]!)) && sum === total };
}
