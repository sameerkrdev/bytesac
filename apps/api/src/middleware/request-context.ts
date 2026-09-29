import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import ipaddr from "ipaddr.js";

export interface RequestMeta { requestId: string; ip: string; ipPrefix: string | null; userAgent: string | null }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { ctx: RequestMeta }
  }
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Coarse network prefix for the sessions list: /24 for IPv4 (IPv4-mapped IPv6 included), /48 for IPv6. */
export function ipPrefixOf(ip: string): string | null {
  if (!ipaddr.isValid(ip)) return null;
  const addr = ipaddr.process(ip);
  if (addr instanceof ipaddr.IPv4) return `${addr.octets.slice(0, 3).join(".")}.0/24`;
  return `${addr.parts.slice(0, 3).map((p) => p.toString(16)).join(":")}::/48`;
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  const ip = req.ip ?? "";
  req.ctx = { requestId, ip, ipPrefix: ipPrefixOf(ip), userAgent: req.header("user-agent")?.slice(0, 512) ?? null };
  res.setHeader("X-Request-Id", requestId);
  next();
}
