import {
  addContactResponseSchema, apiErrorBodySchema, applicationDetailSchema, applicationStatusResponseSchema, confirmApplicationEmailResponseSchema, createApplicationResponseSchema,
  listApplicationsResponseSchema, platformRoleViewSchema, platformRolesResponseSchema, challengeResponseSchema, CLIENT_HEADER, CSRF_HEADER, CSRF_HEADER_VALUE, MOBILE_CLIENT, contactViewSchema,
  listInvitationsResponseSchema, listMemberReviewResponseSchema, listMembersResponseSchema, memberReviewDetailSchema, memberVerificationViewSchema, listMyOrganizationsResponseSchema, listOrganizationsResponseSchema, myMembershipSchema, meResponseSchema, organizationReviewDetailSchema, publicOrganizationSchema, notificationPreferencesSchema, organizationDetailSchema, presignDocumentResponseSchema, sessionsResponseSchema, verifyResponseSchema,
  type AddContactRequest, type AddContactResponse, type ApplicationStatusResponse, type ChallengeRequest, type ChallengeResponse,
  type ApplicationDetail, type GrantRoleRequest, type ListApplicationsQuery, type ListApplicationsResponse, type PlatformRoleView, type PlatformRolesResponse,
  type TransitionApplicationRequest, type ConfirmApplicationEmailRequest, type ConfirmApplicationEmailResponse, type CreateApplicationRequest, type CreateApplicationResponse,
  type ContactView, type MeResponse, type NotificationPreferences, type SessionsResponse,
  type UpdateNotificationPreferences, type VerifyContactRequest, type VerifyRequest, type VerifyResponse,
  type EnterPayoutWalletRequest, type ListOrganizationsQuery, type ListOrganizationsResponse, type OrganizationNoteRequest, type OrganizationReviewDetail, type PayoutWalletDecisionRequest,
  type PublicOrganization, type TransitionOrganizationRequest, type VerifyPayoutWalletRequest, type VersionDecisionRequest,
  type CreateOrganizationRequest, type ListMyOrganizationsResponse, type OrganizationDetail, type PresignDocumentRequest, type PresignDocumentResponse, type UpdateDraftRequest,
  type DecideMemberVerificationRequest, type ListMemberReviewQuery, type ListMemberReviewResponse, type MemberReviewDetail, type MemberVerificationView,
  type TransferOwnershipRequest, type UpdateMemberVerificationRequest,
  type ChangeRoleRequest, type InviteMemberRequest, type ListInvitationsResponse, type ListMembersResponse, type MembershipProfileRequest, type MyMembership,
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
        throw new ApiError(parsed.data.error.code, res.status, parsed.data.error.message, retry !== null && Number.isFinite(n) ? n : undefined, parsed.data.error.details);
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
    createOrganization: (b: CreateOrganizationRequest): Promise<OrganizationDetail> => request("POST", "/v1/organizations", organizationDetailSchema, b),
    myOrganizations: (): Promise<ListMyOrganizationsResponse> => request("GET", "/v1/organizations/mine", listMyOrganizationsResponseSchema),
    getOrganization: (id: string): Promise<OrganizationDetail> => request("GET", `/v1/organizations/${encodeURIComponent(id)}`, organizationDetailSchema),
    updateOrganizationDraft: (id: string, b: UpdateDraftRequest): Promise<OrganizationDetail> =>
      request("PATCH", `/v1/organizations/${encodeURIComponent(id)}/draft`, organizationDetailSchema, b),
    presignOrganizationDocument: (id: string, b: PresignDocumentRequest): Promise<PresignDocumentResponse> =>
      request("POST", `/v1/organizations/${encodeURIComponent(id)}/documents`, presignDocumentResponseSchema, b),
    confirmOrganizationDocument: (id: string, docId: string): Promise<OrganizationDetail> =>
      request("POST", `/v1/organizations/${encodeURIComponent(id)}/documents/${encodeURIComponent(docId)}/confirm`, organizationDetailSchema),
    unlinkOrganizationDocument: (id: string, docId: string): Promise<OrganizationDetail> =>
      request("DELETE", `/v1/organizations/${encodeURIComponent(id)}/draft/documents/${encodeURIComponent(docId)}`, organizationDetailSchema),

    enterPayoutWallet: (id: string, b: EnterPayoutWalletRequest): Promise<OrganizationDetail> =>
      request("POST", `/v1/organizations/${encodeURIComponent(id)}/payout-wallet`, organizationDetailSchema, b),
    createPayoutChallenge: (id: string): Promise<ChallengeResponse> =>
      request("POST", `/v1/organizations/${encodeURIComponent(id)}/payout-wallet/challenge`, challengeResponseSchema),
    verifyPayoutWallet: (id: string, b: VerifyPayoutWalletRequest): Promise<OrganizationDetail> =>
      request("POST", `/v1/organizations/${encodeURIComponent(id)}/payout-wallet/verify`, organizationDetailSchema, b),
    submitOrganization: (id: string): Promise<OrganizationDetail> => request("POST", `/v1/organizations/${encodeURIComponent(id)}/submit`, organizationDetailSchema),
    createOrganizationChangeRequest: (id: string): Promise<OrganizationDetail> =>
      request("POST", `/v1/organizations/${encodeURIComponent(id)}/change-request`, organizationDetailSchema),
    submitOrganizationChangeRequest: (id: string): Promise<OrganizationDetail> =>
      request("POST", `/v1/organizations/${encodeURIComponent(id)}/change-request/submit`, organizationDetailSchema),
    getPublicOrganization: (id: string): Promise<PublicOrganization> => request("GET", `/v1/public/organizations/${encodeURIComponent(id)}`, publicOrganizationSchema),

    listOrganizationMembers: (id: string): Promise<ListMembersResponse> => request("GET", `/v1/organizations/${encodeURIComponent(id)}/members`, listMembersResponseSchema),
    inviteOrganizationMember: (id: string, b: InviteMemberRequest): Promise<ListMembersResponse> =>
      request("POST", `/v1/organizations/${encodeURIComponent(id)}/members/invitations`, listMembersResponseSchema, b),
    cancelMemberInvite: (id: string, mid: string): Promise<ListMembersResponse> =>
      request("POST", `/v1/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(mid)}/cancel`, listMembersResponseSchema),
    changeMemberRole: (id: string, mid: string, b: ChangeRoleRequest): Promise<ListMembersResponse> =>
      request("POST", `/v1/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(mid)}/role`, listMembersResponseSchema, b),
    removeMember: (id: string, mid: string): Promise<ListMembersResponse> =>
      request("POST", `/v1/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(mid)}/remove`, listMembersResponseSchema),
    confirmMemberRemoval: (id: string, mid: string): Promise<ListMembersResponse> =>
      request("POST", `/v1/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(mid)}/removal/confirm`, listMembersResponseSchema),
    cancelMemberRemoval: (id: string, mid: string): Promise<ListMembersResponse> =>
      request("POST", `/v1/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(mid)}/removal/cancel`, listMembersResponseSchema),
    myInvitations: (): Promise<ListInvitationsResponse> => request("GET", "/v1/me/invitations", listInvitationsResponseSchema),
    acceptInvitation: (mid: string): Promise<MyMembership> => request("POST", `/v1/memberships/${encodeURIComponent(mid)}/accept`, myMembershipSchema),
    declineInvitation: (mid: string): Promise<MyMembership> => request("POST", `/v1/memberships/${encodeURIComponent(mid)}/decline`, myMembershipSchema),
    leaveOrganization: (mid: string): Promise<MyMembership> => request("POST", `/v1/memberships/${encodeURIComponent(mid)}/leave`, myMembershipSchema),
    getMembership: (mid: string): Promise<MyMembership> => request("GET", `/v1/memberships/${encodeURIComponent(mid)}`, myMembershipSchema),
    updateMembershipProfile: (mid: string, b: MembershipProfileRequest): Promise<MyMembership> =>
      request("PATCH", `/v1/memberships/${encodeURIComponent(mid)}/profile`, myMembershipSchema, b),

    getMemberVerification: (mid: string): Promise<MemberVerificationView> =>
      request("GET", `/v1/memberships/${encodeURIComponent(mid)}/verification`, memberVerificationViewSchema),
    updateMemberVerification: (mid: string, b: UpdateMemberVerificationRequest): Promise<MemberVerificationView> =>
      request("PATCH", `/v1/memberships/${encodeURIComponent(mid)}/verification`, memberVerificationViewSchema, b),
    presignMemberDocument: (mid: string, b: PresignDocumentRequest): Promise<PresignDocumentResponse> =>
      request("POST", `/v1/memberships/${encodeURIComponent(mid)}/verification/documents`, presignDocumentResponseSchema, b),
    confirmMemberDocument: (mid: string, docId: string): Promise<MemberVerificationView> =>
      request("POST", `/v1/memberships/${encodeURIComponent(mid)}/verification/documents/${encodeURIComponent(docId)}/confirm`, memberVerificationViewSchema),
    unlinkMemberDocument: (mid: string, docId: string): Promise<MemberVerificationView> =>
      request("DELETE", `/v1/memberships/${encodeURIComponent(mid)}/verification/documents/${encodeURIComponent(docId)}`, memberVerificationViewSchema),
    submitMemberVerification: (mid: string): Promise<MemberVerificationView> =>
      request("POST", `/v1/memberships/${encodeURIComponent(mid)}/verification/submit`, memberVerificationViewSchema),

    opsListMembers: (q: ListMemberReviewQuery = {}): Promise<ListMemberReviewResponse> =>
      request("GET", `/v1/ops/members?${new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => e[1] !== undefined))}`, listMemberReviewResponseSchema),
    opsGetMember: (mid: string): Promise<MemberReviewDetail> => request("GET", `/v1/ops/members/${encodeURIComponent(mid)}`, memberReviewDetailSchema),
    opsDecideMember: (mid: string, b: DecideMemberVerificationRequest): Promise<MemberReviewDetail> =>
      request("POST", `/v1/ops/members/${encodeURIComponent(mid)}/decision`, memberReviewDetailSchema, b),
    opsTransferOwnership: (id: string, b: TransferOwnershipRequest): Promise<void> =>
      request<z.ZodVoid>("POST", `/v1/ops/organizations/${encodeURIComponent(id)}/transfer-ownership`, null, b),

    opsListOrganizations: (q: ListOrganizationsQuery = {}): Promise<ListOrganizationsResponse> =>
      request("GET", `/v1/ops/organizations?${new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => e[1] !== undefined))}`, listOrganizationsResponseSchema),
    opsGetOrganization: (id: string): Promise<OrganizationReviewDetail> => request("GET", `/v1/ops/organizations/${encodeURIComponent(id)}`, organizationReviewDetailSchema),
    opsTransitionOrganization: (id: string, b: TransitionOrganizationRequest): Promise<OrganizationReviewDetail> =>
      request("POST", `/v1/ops/organizations/${encodeURIComponent(id)}/transition`, organizationReviewDetailSchema, b),
    opsDecideOrganizationVersion: (id: string, versionId: string, b: VersionDecisionRequest): Promise<OrganizationReviewDetail> =>
      request("POST", `/v1/ops/organizations/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/decision`, organizationReviewDetailSchema, b),
    opsDecidePayoutWallet: (id: string, walletId: string, b: PayoutWalletDecisionRequest): Promise<OrganizationReviewDetail> =>
      request("POST", `/v1/ops/organizations/${encodeURIComponent(id)}/payout-wallets/${encodeURIComponent(walletId)}/decision`, organizationReviewDetailSchema, b),
    opsAddOrganizationNote: (id: string, b: OrganizationNoteRequest): Promise<OrganizationReviewDetail> =>
      request("POST", `/v1/ops/organizations/${encodeURIComponent(id)}/notes`, organizationReviewDetailSchema, b),

    opsListRoles: (): Promise<PlatformRolesResponse> => request("GET", "/v1/ops/roles", platformRolesResponseSchema),
    opsGrantRole: (b: GrantRoleRequest): Promise<PlatformRoleView> => request("POST", "/v1/ops/roles", platformRoleViewSchema, b),
    opsRevokeRole: (id: string): Promise<void> => request<z.ZodVoid>("DELETE", `/v1/ops/roles/${encodeURIComponent(id)}`, null),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
