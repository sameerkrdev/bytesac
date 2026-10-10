import { NextResponse, type NextRequest } from "next/server";
import { PREVIEW_GATE_COOKIE } from "@repo/validator";
import { verifyPreviewGateToken } from "@/lib/preview-gate-token";

const marketingHost = () => (process.env.MARKETING_HOST ?? "").trim().toLowerCase();
const appHost = () => (process.env.APP_HOST ?? process.env.WEB_DOMAIN ?? "").trim().toLowerCase();
const previewSecret = () => (process.env.PREVIEW_GATE_JWT_SECRET ?? "").trim();

function hostName(req: NextRequest): string {
  const raw = req.headers.get("host") ?? "";
  return raw.split(":")[0]?.toLowerCase() ?? "";
}

function isStatic(pathname: string): boolean {
  return pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.endsWith(".ico");
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isStatic(pathname)) return NextResponse.next();

  const host = hostName(req);
  const marketing = marketingHost();
  const app = appHost();

  if (marketing && host === marketing) {
    if (pathname === "/" || pathname === "/waitlist") {
      if (pathname === "/") return NextResponse.rewrite(new URL("/waitlist", req.url));
      return NextResponse.next();
    }
    if (app) {
      const dest = new URL(pathname + req.nextUrl.search, `https://${app}`);
      return NextResponse.redirect(dest);
    }
    return NextResponse.redirect(new URL("/waitlist", req.url));
  }

  if (app && host === app) {
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/home", req.url));
    }
    const secret = previewSecret();
    if (secret.length >= 32) {
      const open = pathname === "/preview-access" || pathname.startsWith("/api/");
      if (!open) {
        const token = req.cookies.get(PREVIEW_GATE_COOKIE)?.value;
        if (!verifyPreviewGateToken(token, secret)) {
          const login = new URL("/preview-access", req.url);
          login.searchParams.set("next", pathname);
          return NextResponse.redirect(login);
        }
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
