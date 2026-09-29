import {
  addContactResponseSchema, apiErrorBodySchema, applicationDetailSchema, applicationStatusResponseSchema, confirmApplicationEmailResponseSchema, createApplicationResponseSchema,
  listApplicationsResponseSchema, platformRoleViewSchema, platformRolesResponseSchema, challengeResponseSchema, CLIENT_HEADER, CSRF_HEADER, CSRF_HEADER_VALUE, MOBILE_CLIENT, contactViewSchema,
  meResponseSchema, notificationPreferencesSchema, sessionsResponseSchema, verifyResponseSchema,
  type AddContactRequest, type AddContactResponse, type ApplicationStatusResponse, type ChallengeRequest, type ChallengeResponse,
  type ApplicationDetail, type GrantRoleRequest, type ListApplicationsQuery, type ListApplicationsResponse, type PlatformRoleView, type PlatformRolesResponse,
  type TransitionApplicationRequest, type ConfirmApplicationEmailRequest, type ConfirmApplicationEmailResponse, type CreateApplicationRequest, type CreateApplicationResponse,
  type ContactView, type MeResponse, type NotificationPreferences, type SessionsResponse,
  type UpdateNotificationPreferences, type VerifyContactRequest, type VerifyRequest, type VerifyResponse,
  type z,
} from "@repo/validator";
import { ApiError } from "./api-error";

export type Transport = { kind: "cookie" } | { kind: "bearer"; getToken: () => Promise<string | null> };
export interface ApiClientOptions { baseUrl: string; transport: Transport; fetch?: typeof fetch }

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function request<S extends z.ZodType = z.ZodVoid>(method: Method, path: string, schema: S | null, body?: unknown, extraHeaders?: Record<string, string>): Promise<z.infer<S>> {
    const headers = new Headers({ Accept: "application/json", [CSRF_HEADER]: CSRF_HEADER_VALUE, ...extraHeaders });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (options.transport.kind === "bearer") {
      // Native clients identify themselves so the API's CSRF guard can exempt Origin-less mobile sign-in.
      headers.set(CLIENT_HEADER, MOBILE_CLIENT);
      const token = await options.transport.getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }
    let res: Response;
    try {
      res = await doFetch(`${options.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: options.transport.kind === "cookie" ? "same-origin" : "omit",
      });
    } catch {
      throw new ApiError("NETWORK_ERROR", 0, "Network request failed");
    }
    if (!res.ok) {
      const retry = res.headers.get("retry-after");
      const parsed = apiErrorBodySchema.safeParse(await res.json().catch(() => null));
      if (parsed.success) {
        const n = Number(retry);
        throw new ApiError(parsed.data.error.code, res.status, parsed.data.error.message, retry !== null && Number.isFinite(n) ? n : undefined);
      }
      throw new ApiError("INTERNAL", res.status, `Unexpected ${res.status} response`);
    }
    if (schema === null) return undefined as z.infer<S>;
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new ApiError("INTERNAL", res.status, "Malformed response");
    return parsed.data;
  }

  return {
    createChallenge: (b: ChallengeRequest): Promise<ChallengeResponse> => request("POST", "/v1/auth/challenge", challengeResponseSchema, b),
    verify: (b: VerifyRequest): Promise<VerifyResponse> => request("POST", "/v1/auth/verify", verifyResponseSchema, b),
    logout: (): Promise<void> => request<z.ZodVoid>("POST", "/v1/auth/logout", null),
    logoutAll: (): Promise<void> => request<z.ZodVoid>("POST", "/v1/auth/logout-all", null),
    me: (): Promise<MeResponse> => request("GET", "/v1/me", meResponseSchema),
    sessions: (): Promise<SessionsResponse> => request("GET", "/v1/me/sessions", sessionsResponseSchema),
    revokeSession: (id: string): Promise<void> => request<z.ZodVoid>("DELETE", `/v1/me/sessions/${encodeURIComponent(id)}`, null),
    addContact: (b: AddContactRequest): Promise<AddContactResponse> => request("POST", "/v1/me/contacts", addContactResponseSchema, b),
    verifyContact: (id: string, b: VerifyContactRequest): Promise<ContactView> =>
      request("POST", `/v1/me/contacts/${encodeURIComponent(id)}/verify`, contactViewSchema, b),
    resendContact: (id: string): Promise<AddContactResponse> =>
      request("POST", `/v1/me/contacts/${encodeURIComponent(id)}/resend`, addContactResponseSchema),
    getPreferences: (): Promise<NotificationPreferences> => request("GET", "/v1/me/notification-preferences", notificationPreferencesSchema),
    updatePreferences: (b: UpdateNotificationPreferences): Promise<NotificationPreferences> =>
      request("PATCH", "/v1/me/notification-preferences", notificationPreferencesSchema, b),

    createApplication: (b: CreateApplicationRequest): Promise<CreateApplicationResponse> =>
      request("POST", "/v1/manager-applications", createApplicationResponseSchema, b),
    confirmApplicationEmail: (id: string, b: ConfirmApplicationEmailRequest): Promise<ConfirmApplicationEmailResponse> =>
      request("POST", `/v1/manager-applications/${encodeURIComponent(id)}/confirm-email`, confirmApplicationEmailResponseSchema, b),
    resendApplicationCode: (id: string): Promise<void> =>
      request<z.ZodVoid>("POST", `/v1/manager-applications/${encodeURIComponent(id)}/resend-code`, null),
    getApplicationStatus: (token: string): Promise<ApplicationStatusResponse> =>
      request("GET", "/v1/manager-applications/status", applicationStatusResponseSchema, undefined, { "X-Application-Token": token }),
    replyToApplication: (token: string, message: string): Promise<void> =>
      request<z.ZodVoid>("POST", "/v1/manager-applications/reply", null, { message }, { "X-Application-Token": token }),
    opsListApplications: (q: ListApplicationsQuery = {}): Promise<ListApplicationsResponse> =>
      request("GET", `/v1/ops/applications?${new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => e[1] !== undefined))}`, listApplicationsResponseSchema),
    opsGetApplication: (id: string): Promise<ApplicationDetail> => request("GET", `/v1/ops/applications/${encodeURIComponent(id)}`, applicationDetailSchema),
    opsTransitionApplication: (id: string, b: TransitionApplicationRequest): Promise<ApplicationDetail> =>
      request("POST", `/v1/ops/applications/${encodeURIComponent(id)}/transition`, applicationDetailSchema, b),
    opsAddApplicationNote: (id: string, internalNote: string): Promise<ApplicationDetail> =>
      request("POST", `/v1/ops/applications/${encodeURIComponent(id)}/notes`, applicationDetailSchema, { internalNote }),
    opsListRoles: (): Promise<PlatformRolesResponse> => request("GET", "/v1/ops/roles", platformRolesResponseSchema),
    opsGrantRole: (b: GrantRoleRequest): Promise<PlatformRoleView> => request("POST", "/v1/ops/roles", platformRoleViewSchema, b),
    opsRevokeRole: (id: string): Promise<void> => request<z.ZodVoid>("DELETE", `/v1/ops/roles/${encodeURIComponent(id)}`, null),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
