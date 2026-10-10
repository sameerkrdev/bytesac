import { PREVIEW_GATE_COOKIE, SESSION_COOKIE } from "@repo/validator";
import { cookies } from "next/headers";

export const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

/**
 * Headers for a server-side call to the API. Server components call API_ORIGIN directly (not through the /api rewrite),
 * so the browser's cookies must be forwarded: always the soft-launch gate token (the API refuses everything without it
 * while the gate is on), and the session only where the page asks for it.
 */
export async function apiHeaders({ session = false }: { session?: boolean } = {}): Promise<Record<string, string>> {
  const jar = await cookies();
  const cookie = [session ? SESSION_COOKIE : null, PREVIEW_GATE_COOKIE]
    .flatMap((name) => { const c = name ? jar.get(name) : undefined; return c ? [`${c.name}=${encodeURIComponent(c.value)}`] : []; })
    .join("; ");
  return { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) };
}

/** `fetch` for `createApiClient` on the server: adds the forwarded cookies to every request. */
export const serverFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(await apiHeaders())) headers.set(k, v);
  return fetch(input, { ...init, headers, cache: "no-store" });
};
