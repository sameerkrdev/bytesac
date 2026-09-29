import { randomUUID } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import type { NextFunction, Request, Response } from "express";

export interface RequestMeta { requestId: string; ip: string; ipPrefix: string | null; userAgent: string | null }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { ctx: RequestMeta }
  }
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

function expandIPv6(ip: string): string[] | null {
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  if (ip.includes("::")) {
    const fill = 8 - h.length - t.length;
    if (fill < 0) return null;
    return [...h, ...Array<string>(fill).fill("0"), ...t];
  }
  return h.length === 8 ? h : null;
}

export function ipPrefixOf(ip: string): string | null {
  const mapped = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIPv4(mapped)) {
    const [a, b, c] = mapped.split(".");
    return `${a}.${b}.${c}.0/24`;
  }
  if (isIPv6(ip)) {
    const parts = expandIPv6(ip);
    if (!parts) return null;
    return `${parts.slice(0, 3).map((p) => p.replace(/^0+(?=.)/, "")).join(":")}::/48`;
  }
  return null;
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  const ip = req.ip ?? "";
  req.ctx = { requestId, ip, ipPrefix: ipPrefixOf(ip), userAgent: req.header("user-agent")?.slice(0, 512) ?? null };
  res.setHeader("X-Request-Id", requestId);
  next();
}
