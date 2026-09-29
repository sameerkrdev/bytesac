import { createApiClient } from "@repo/api-client";

export const api = createApiClient({ baseUrl: "/api", transport: { kind: "cookie" } });
