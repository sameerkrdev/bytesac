/**
 * The apex (marketing) host serves the waitlist and the static explainer pages only; every other path goes to the app
 * host. Shared by `proxy.ts` (routing) and the marketing chrome (which links only to these).
 */
export const MARKETING_PATHS = ["/waitlist", "/how-it-works", "/self-custody", "/for-managers", "/help"] as const;

export const SURFACE_HEADER = "x-bx-surface";

export const isMarketingPath = (pathname: string) =>
  pathname === "/" || MARKETING_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** Only same-site relative paths: `//host` and `/\host` are protocol-relative to browsers and would leave the site. */
export function safeNext(next: string | null, fallback = "/home"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
