import "server-only";
import { SESSION_COOKIE, meResponseSchema, type MeResponse } from "@repo/validator";
import { cookies } from "next/headers";
import { API_ORIGIN, apiHeaders } from "@/lib/server-api";

export async function getServerMe(): Promise<MeResponse | null> {
  if (!(await cookies()).get(SESSION_COOKIE)) return null;
  const res = await fetch(`${API_ORIGIN}/v1/me`, {
    headers: await apiHeaders({ session: true }),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`GET /v1/me failed: ${res.status}`);
  return meResponseSchema.parse(await res.json());
}
