export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const units: Array<[number, string]> = [[86_400, "day"], [3_600, "hour"], [60, "minute"]];
  for (const [size, name] of units) {
    if (s >= size) {
      const n = Math.floor(s / size);
      return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

/** 2550 -> "25.5%". */
export const formatBps = (bps: number): string => `${bps / 100}%`;

/** A decimal-string fraction as a percent: "0.1234" -> "12.34%" (with `signed`, "+12.34%"). */
export const formatFraction = (f: string, signed = false): string => `${signed && Number(f) > 0 ? "+" : ""}${(Number(f) * 100).toFixed(2)}%`;

const microOf = (v: string) => { const [w = "0", f = ""] = v.split("."); return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0")); };

/** Why an invest amount can't be planned, or null. The server checks the same rules and the wallet balance. */
export function investAmountProblem(amount: string, minimum: string | null, increment: string | null): string | null {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(amount)) return "Enter an amount in USDC, with up to 6 decimals.";
  const a = microOf(amount);
  if (minimum && a < microOf(minimum)) return `The minimum is ${minimum} USDC.`;
  if (increment && microOf(increment) > 0n && a % microOf(increment) !== 0n) return `The amount must be a multiple of ${increment} USDC.`;
  return a > 0n ? null : "Enter an amount above zero.";
}
