import { createApiClient } from "@repo/api-client";
import { tokenStore } from "./token-store";

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:4000";
export const api = createApiClient({ baseUrl, transport: { kind: "bearer", getToken: () => tokenStore.get() } });
