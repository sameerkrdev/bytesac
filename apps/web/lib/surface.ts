/**
 * The apex (marketing) host serves the waitlist and the static explainer pages only; every other page path goes to the
 * app host (`/api/*` and static files stay on the apex). Shared by `proxy.ts` and the marketing chrome.
 */
export const MARKETING_PATHS = ["/waitlist", "/how-it-works", "/self-custody", "/for-managers", "/help"] as const;

export const SURFACE_HEADER = "x-bx-surface";

export const isMarketingPath = (pathname: string) =>
  pathname === "/" || MARKETING_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * Only same-site relative paths. Prefix checks alone are not enough: browsers treat `//host` and `/\host` as other sites
 * and strip tabs and newlines (`/\t/host` becomes `//host`), so control characters and backslashes are refused and the
 * value is resolved against a placeholder origin that it must not leave.
 */
export function safeNext(next: string | null, fallback = "/home"): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is being refused
  if (!next || /[\x00-\x20\\]/.test(next) || !next.startsWith("/") || next.startsWith("//")) return fallback;
  const base = "https://same.invalid";
  try {
    const u = new URL(next, base);
    return u.origin === base ? u.pathname + u.search + u.hash : fallback;
  } catch {
    return fallback;
  }
}
