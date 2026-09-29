import "server-only";
import { meResponseSchema, type MeResponse } from "@repo/validator";
import { cookies } from "next/headers";

export async function getServerMe(): Promise<MeResponse | null> {
  const jar = await cookies();
  const session = jar.get("bx_session");
  if (!session) return null;
  const res = await fetch(`${process.env.API_ORIGIN ?? "http://localhost:4000"}/v1/me`, {
    headers: { Cookie: `bx_session=${encodeURIComponent(session.value)}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`GET /v1/me failed: ${res.status}`);
  return meResponseSchema.parse(await res.json());
}
