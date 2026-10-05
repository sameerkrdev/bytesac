/* global process */
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:4000";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.gstatic.com", // gstatic: Firebase messaging service worker scripts
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.walletconnect.com wss://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.org https://*.reown.com wss://*.reown.com https://*.web3modal.org https://*.r2.cloudflarestorage.com https://fcmregistrations.googleapis.com https://firebaseinstallations.googleapis.com https://fcm.googleapis.com",
  "frame-src https://verify.walletconnect.com https://verify.walletconnect.org https://secure.walletconnect.org https://*.reown.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig = {
  // Docker images build with NEXT_OUTPUT=standalone (apps/web/Dockerfile): a self-contained server traced from the
  // monorepo root. Unset keeps the default output for `next start` and Vercel.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone", outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)) } : {}),
  // @coinbase/cdp-sdk (transitive of Reown) lazily imports optional @x402/* peers we never use.
  serverExternalPackages: ["@coinbase/cdp-sdk"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/:path*` }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        { key: "Content-Security-Policy-Report-Only", value: csp },
      ],
    }];
  },
};

export default nextConfig;
