import type { ClientKind } from "@repo/contracts";

const H = 3_600_000;
export const SESSION_POLICY: Readonly<Record<ClientKind, { idle: string; absolute: string; idleMs: number; absoluteMs: number }>> = {
  web: { idle: "12 hours", absolute: "7 days", idleMs: 12 * H, absoluteMs: 7 * 24 * H },
  mobile: { idle: "7 days", absolute: "30 days", idleMs: 7 * 24 * H, absoluteMs: 30 * 24 * H },
};
export const RENEWAL_THROTTLE = "5 minutes";
export const CHALLENGE_TTL = "5 minutes";
export const CHALLENGE_LEASE = "30 seconds";
