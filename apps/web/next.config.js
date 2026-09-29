/* global process */
/** @type {import('next').NextConfig} */
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:4000";

const nextConfig = {
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
      ],
    }];
  },
};

export default nextConfig;
