import { NextResponse, type NextRequest } from "next/server";
import { PREVIEW_GATE_COOKIE } from "@repo/validator";
import { verifyPreviewGateToken } from "@/lib/preview-gate-token";
import { isMarketingPath, SURFACE_HEADER } from "@/lib/surface";

const marketingHost = () => (process.env.MARKETING_HOST ?? "").trim().toLowerCase();
const appHost = () => (process.env.APP_HOST ?? process.env.WEB_DOMAIN ?? "").trim().toLowerCase();
const previewSecret = () => (process.env.PREVIEW_GATE_JWT_SECRET ?? "").trim();

function hostName(req: NextRequest): string {
  const raw = req.headers.get("host") ?? "";
  return raw.split(":")[0]?.toLowerCase() ?? "";
}

/** Build output and public files (`/visuals/…webp`, `/brand/…png`, `/favicon.ico`, `/robots.txt`): never gated or redirected. */
const isStatic = (pathname: string) => pathname.startsWith("/_next/") || /\/[^/]+\.[a-z0-9]+$/i.test(pathname);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isStatic(pathname)) return NextResponse.next();

  // The surface header is ours alone: drop whatever the client sent.
  const headers = new Headers(req.headers);
  headers.delete(SURFACE_HEADER);
  const host = hostName(req);
  const marketing = marketingHost();
  const app = appHost();

  if (marketing && host === marketing) {
    if (isMarketingPath(pathname)) {
      headers.set(SURFACE_HEADER, "marketing");
      if (pathname === "/") return NextResponse.rewrite(new URL("/waitlist", req.url), { request: { headers } });
      return NextResponse.next({ request: { headers } });
    }
    // Same-origin /api rewrite must stay on the apex (waitlist join); redirecting would cross-origin and fail CORS.
    if (pathname.startsWith("/api/")) return NextResponse.next({ request: { headers } });
    if (app) return NextResponse.redirect(new URL(pathname + req.nextUrl.search, `https://${app}`));
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (app && host === app) {
    if (pathname === "/") return NextResponse.redirect(new URL("/home", req.url));
    const secret = previewSecret();
    if (secret.length >= 32 && pathname !== "/preview-access" && !pathname.startsWith("/api/")) {
      if (!verifyPreviewGateToken(req.cookies.get(PREVIEW_GATE_COOKIE)?.value, secret)) {
        const login = new URL("/preview-access", req.url);
        login.searchParams.set("next", pathname + req.nextUrl.search);
        return NextResponse.redirect(login);
      }
    }
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
