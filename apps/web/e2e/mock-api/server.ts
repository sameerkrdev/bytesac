/**
 * Mock Bytesac API for visual QA and local design work (never shipped). Every response is parsed with the real
 * @repo/validator schema before it is sent, so the mock cannot drift from the contract unnoticed.
 *
 *   pnpm --filter web mock-api          # listens on :4000 (API_ORIGIN)
 *
 * Signed-in state: a `bx_session=mock-*` cookie. GET /v1/__mock/sign-in?as=investor|manager|ops sets it and
 * redirects home; /v1/__mock/sign-out clears it. The web's /api rewrite makes these reachable at /api/v1/__mock/*.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  aiSearchResponseSchema, discoveryFiltersSchema, discoverySearchResponseSchema, meResponseSchema, publicBasketResponseSchema, publicFeesSchema, publicManagerSchema, publicOrganizationSchema,
  type z,
} from "@repo/validator";
import { BASKETS, basketDetail, publicManager, publicOrganization, searchItem } from "./catalog";
import { meFor, type Persona } from "./personas";
import { managerRoutes } from "./manager";
import { opsRoutes } from "./ops";
import { extraRoutes } from "./routes";

const PORT = Number(process.env.MOCK_API_PORT ?? 4000);

export type Ctx = { req: IncomingMessage; url: URL; persona: Persona | null; body: unknown };
export type Handler = (ctx: Ctx, params: string[]) => { status?: number; schema?: z.ZodType; body?: unknown; headers?: Record<string, string> } | null;
export type Route = [method: string, pattern: RegExp, handler: Handler];

const personaOf = (req: IncomingMessage): Persona | null => {
  const m = /(?:^|;\s*)bx_session=mock-(investor|manager|ops|new)/.exec(req.headers.cookie ?? "");
  return (m?.[1] as Persona | undefined) ?? null;
};

const unauthorized = { status: 401, body: { error: { code: "SESSION_EXPIRED", message: "Sign in to continue." } } };
const notFound = { status: 404, body: { error: { code: "NOT_FOUND", message: "Not found." } } };

const decodeFilters = (f: string | null) => {
  try {
    return discoveryFiltersSchema.parse(JSON.parse(Buffer.from(f ?? "", "base64url").toString("utf8") || "{}"));
  } catch {
    return {};
  }
};

const ROUTES: Route[] = [
  ["GET", /^\/v1\/__mock\/sign-in$/, ({ url }) => ({ status: 302, headers: { "Set-Cookie": `bx_session=mock-${url.searchParams.get("as") ?? "investor"}; Path=/; HttpOnly; SameSite=Lax`, Location: url.searchParams.get("to") ?? "/home" } })],
  ["GET", /^\/v1\/__mock\/sign-out$/, () => ({ status: 302, headers: { "Set-Cookie": "bx_session=; Path=/; Max-Age=0", Location: "/" } })],

  ["GET", /^\/v1\/me$/, ({ persona }) => (persona ? { schema: meResponseSchema, body: meFor(persona) } : unauthorized)],

  ["GET", /^\/v1\/public\/fees$/, () => ({ schema: publicFeesSchema, body: { platform: [
    { operationKind: "invest", bps: 0, minUsdc: null, maxUsdc: null }, { operationKind: "rebalance_apply", bps: 0, minUsdc: null, maxUsdc: null },
    { operationKind: "rebalance_drift", bps: 0, minUsdc: null, maxUsdc: null }, { operationKind: "repair", bps: 0, minUsdc: null, maxUsdc: null },
    { operationKind: "sell_to_usdc", bps: 0, minUsdc: null, maxUsdc: null }, { operationKind: "sell_former", bps: 0, minUsdc: null, maxUsdc: null },
  ] } })],

  ["GET", /^\/v1\/public\/discovery\/baskets$/, ({ url }) => {
    const f = decodeFilters(url.searchParams.get("f"));
    let items = BASKETS.map(searchItem);
    if (f.q) items = items.filter((i) => `${i.name} ${i.shortDescription} ${i.organizationName}`.toLowerCase().includes(f.q!.toLowerCase()));
    if (f.categories?.length) items = items.filter((i) => f.categories!.includes(i.category));
    if (f.maxSingleWeightBps) items = items.filter((i) => i.topAssets.every((a) => a.bps <= f.maxSingleWeightBps!));
    return { schema: discoverySearchResponseSchema, body: { items, nextCursor: null } };
  }],
  ["POST", /^\/v1\/public\/discovery\/ai-search$/, () => ({ schema: aiSearchResponseSchema, body: {
    mode: "tool",
    filters: { assets: [{ symbol: "BTC" }, { symbol: "ETH" }, { symbol: "SOL" }], assetTypes: [{ type: "TOKENIZED_TREASURY" }], maxSingleWeightBps: 3000, reviewFrequencies: ["monthly"], maxFeeBps: { management: 75 } },
    results: [searchItem(BASKETS[1]!)],
  } })],
  ["GET", /^\/v1\/public\/baskets\/([^/]+)$/, ({ persona }, [slug]) => {
    const seed = BASKETS.find((b) => b.slug === slug);
    return seed ? { schema: publicBasketResponseSchema, body: basketDetail(seed, persona !== null) } : notFound;
  }],
  ["GET", /^\/v1\/public\/managers\/([^/]+)$/, (_c, [handle]) => {
    const m = publicManager(handle!);
    return m ? { schema: publicManagerSchema, body: m } : notFound;
  }],
  ["GET", /^\/v1\/public\/organizations\/([^/]+)$/, (_c, [id]) => {
    const o = publicOrganization(id!);
    return o ? { schema: publicOrganizationSchema, body: o } : notFound;
  }],
  ...extraRoutes,
  ...managerRoutes,
  ...opsRoutes,
];

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return raw;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname.replace(/^\/api(?=\/v1)/, "");
  const ctx: Ctx = { req, url, persona: personaOf(req), body: await readBody(req) };
  for (const [method, pattern, handler] of ROUTES) {
    if (method !== req.method) continue;
    const m = pattern.exec(path);
    if (!m) continue;
    const out = handler(ctx, m.slice(1).map(decodeURIComponent));
    if (!out) break;
    const status = out.status ?? 200;
    let body = out.body;
    if (out.schema && status < 300) {
      const parsed = out.schema.safeParse(body);
      if (!parsed.success) {
        console.error(`[mock-api] ${req.method} ${path} fixture does not match its schema:`, parsed.error.issues.slice(0, 5));
        res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { code: "INTERNAL", message: "Mock fixture invalid." } }));
        return;
      }
      body = parsed.data;
    }
    res.writeHead(status, { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...out.headers });
    res.end(body === undefined ? undefined : JSON.stringify(body));
    console.log(`[mock-api] ${req.method} ${path} → ${status}`);
    return;
  }
  console.warn(`[mock-api] ${req.method} ${path} → 404 (no mock)`);
  res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify(notFound.body));
}

createServer((req, res) => void handle(req, res)).listen(PORT, () => console.log(`[mock-api] listening on http://localhost:${PORT}`));
