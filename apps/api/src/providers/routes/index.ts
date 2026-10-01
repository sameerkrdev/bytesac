import { env } from "../../env";
import { lifi } from "./lifi";
import type { RouteProvider } from "./types";

const PROVIDERS: Record<string, RouteProvider> = { lifi };

export const routeProviderById = (id: string): RouteProvider | undefined => PROVIDERS[id];

/** The first provider in `ROUTE_PROVIDER_ORDER` that one of the registry route provider names maps to ("LI.FI" and "lifi" both match). */
export function selectRouteProvider(registryProviderNames: string[]): RouteProvider | undefined {
  const names = registryProviderNames.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const id = env.ROUTE_PROVIDER_ORDER.find((p) => names.includes(p));
  return id ? PROVIDERS[id] : undefined;
}
