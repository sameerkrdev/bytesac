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
