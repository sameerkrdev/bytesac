import {
  eligibilityResponseSchema, lifiTransfersSchema, routePolicyEntrySchema, routingViewSchema, type EligibilityDeclarationInput, type EligibilityResponse, type FeeOnTransferRequest, type PermissionedRequest, type LifiTransfers, type RoutePolicyEntry, type RoutePolicyInput, type RoutingView,
  earningsSchema, platformFeeListSchema, platformFeeScheduleViewSchema, publicFeesSchema, revenueSchema,
  type Earnings, type EarningsQuery, type PlatformFeeList, type PlatformFeeOverrideInput, type PlatformFeeScheduleInput, type PlatformFeeScheduleView, type PublicFees, type Revenue,
  bitcoinChallengeResponseSchema, rebalanceResponseSchema, syncResultSchema, adoptionSchema, notificationsPageSchema, investabilitySchema, legQuoteResponseSchema, operationSchema, portfolioSchema, type Investability, type InvestRequest, type LegQuoteResponse, type LegSubmit, type OperationView, type Portfolio, type SellRequest, type RebalanceRequest, type RepairRequest, type SkipRequest, type SyncRequest, type SyncResult, type Adoption, type NotificationsPage, type PushToken, type BitcoinChallengeRequest, type BitcoinChallengeResponse, type BitcoinVerify,
  aiSearchResponseSchema, assetTagViewSchema, discoveryCollectionsResponseSchema, discoveryFiltersSchema, discoverySearchResponseSchema, setBasketFeaturedResponseSchema, suggestedBasketsResponseSchema, listAssetTagsResponseSchema, listOpsManagerProfilesResponseSchema, managerProfileViewSchema, ownManagerProfileResponseSchema, publicManagerSchema,
  type AiSearchResponse, type AssetTagView, type CreateAssetTagRequest, type DiscoveryCollectionsResponse, type AssignCustomRoleRequest, type CreateCustomRoleRequest, type ListRolesResponse, type UpdateCustomRoleRequest, type ConfirmBasketFileRequest, type PresignBasketFileRequest, type PresignFileResponse, type PresignLogoRequest, type DiscoveryFilters, type DiscoverySearchResponse, type SetBasketFeaturedRequest, type SetBasketFeaturedResponse, type SuggestedBasketsResponse, type HideManagerProfileRequest, type ListAssetTagsResponse,
  type ListOpsManagerProfilesQuery, type ListOpsManagerProfilesResponse, type ManagerProfileRequest, type ManagerProfileView, type OwnManagerProfileResponse, type PublicManager,
  listDisclosureTemplatesResponseSchema, opsBasketDetailSchema, opsBasketListResponseSchema, publicBasketListResponseSchema, publicBasketResponseSchema,
  type BasketApprovalRequest, type BasketReasonRequest, type BasketReviewDecisionRequest, type CreateDisclosureTemplateRequest, type ListDisclosureTemplatesResponse, type ListOpsBasketsQuery,
  type OpsBasketDetail, type OpsBasketListResponse, type PublicBasketListResponse, type PublicBasketResponse,
  basketDetailSchema, basketDiffSchema, presignFileResponseSchema, basketPreviewSchema, basketValidationSchema, listBasketsResponseSchema, listBasketVersionsResponseSchema,
  type BasketDetail, type BasketDiff, type BasketPreview, type BasketValidation, type CreateAssignmentRequest, type CreateBasketRequest, type EndAssignmentRequest, type ListBasketsQuery,
  type ListBasketsResponse, type ListBasketVersionsResponse, type SaveBasketDraftRequest, type UpdateAssignmentRequest,
  assetProviderViewSchema, priceViewSchema, publicAssetDetailSchema, publicAssetListResponseSchema, issuerViewSchema, opsAssetDetailSchema, opsAssetListResponseSchema,
  type AssetDecisionRequest, type AssetListQuery, type PriceView, type PublicAssetDetail, type PublicAssetListResponse, type AssetProviderRequest, type AssetProviderView, type CreateDeploymentRequest, type CreateInstrumentRequest, type CreateRouteRequest, type CreateRuleRequest, type IssuerRequest, type IssuerView,
  type NavEntryRequest, type OpsAssetDetail, type OpsAssetListQuery, type OpsAssetListResponse, type PutPriceReferenceRequest, type UpdateAssetProviderRequest, type UpdateDeploymentRequest,
  type UpdateInstrumentRequest, type UpdateIssuerRequest, type UpdateRouteRequest, type UpdateRuleRequest,
  addContactResponseSchema, apiErrorBodySchema, applicationDetailSchema, applicationStatusResponseSchema, confirmApplicationEmailResponseSchema, createApplicationResponseSchema,
  listApplicationsResponseSchema, platformRoleViewSchema, platformRolesResponseSchema, challengeResponseSchema, CLIENT_HEADER, CSRF_HEADER, CSRF_HEADER_VALUE, MOBILE_CLIENT, contactViewSchema,
  listInvitationsResponseSchema, listMemberReviewResponseSchema, listMembersResponseSchema, listRolesResponseSchema, memberReviewDetailSchema, memberVerificationViewSchema, listMyOrganizationsResponseSchema, listOrganizationsResponseSchema, myMembershipSchema, meResponseSchema, organizationReviewDetailSchema, publicOrganizationSchema, notificationPreferencesSchema, organizationDetailSchema, presignDocumentResponseSchema, sessionsResponseSchema, verifyResponseSchema,
  type AddContactRequest, type AddContactResponse, type ApplicationStatusResponse, type ChallengeRequest, type ChallengeResponse,
  type ApplicationDetail, type GrantRoleRequest, type ListApplicationsQuery, type ListApplicationsResponse, type PlatformRoleView, type PlatformRolesResponse,
  type TransitionApplicationRequest, type ConfirmApplicationEmailRequest, type ConfirmApplicationEmailResponse, type CreateApplicationRequest, type CreateApplicationResponse,
  type ContactView, type MeResponse, type NotificationPreferences, type SessionsResponse,
  type UpdateNotificationPreferences, type ReassignRequest, type VerifyContactRequest, type VerifyRequest, type VerifyResponse,
  type EnterPayoutWalletRequest, type ListOrganizationsQuery, type ListOrganizationsResponse, type OrganizationNoteRequest, type OrganizationReviewDetail, type PayoutWalletDecisionRequest,
  type PublicOrganization, type TransitionOrganizationRequest, type VerifyPayoutWalletRequest, type VersionDecisionRequest,
  type CreateOrganizationRequest, type ListMyOrganizationsResponse, type OrganizationDetail, type PresignDocumentRequest, type PresignDocumentResponse, type UpdateDraftRequest,
  type DecideMemberVerificationRequest, type ListMemberReviewQuery, type ListMemberReviewResponse, type MemberReviewDetail, type MemberVerificationView,
  type TransferOwnershipRequest, type UpdateMemberVerificationRequest,
  type ChangeRoleRequest, type InviteMemberRequest, type ListInvitationsResponse, type ListMembersResponse, type MembershipProfileRequest, type MyMembership,
  waitlistJoinResponseSchema, previewGateLoginResponseSchema,
  type WaitlistEmailJoinRequest, type WaitlistJoinRequest, type WaitlistJoinResponse, type PreviewGateLoginRequest, type PreviewGateLoginResponse,
  type z,
} from "@repo/validator";
import { ApiError } from "./api-error";

export type Transport = { kind: "cookie" } | { kind: "bearer"; getToken: () => Promise<string | null> };
export interface ApiClientOptions { baseUrl: string; transport: Transport; fetch?: typeof fetch }

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const e = encodeURIComponent;
const qs = (q: object) => new URLSearchParams(Object.entries(q).filter((x): x is [string, string] => x[1] !== undefined));

/** Encodes filters (without the cursor) as base64url JSON. */
export const encodeDiscoveryFilters = (f: DiscoveryFilters): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(f)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

/** Decodes an `f` param; anything malformed or invalid is ignored (no filters). */
export function decodeDiscoveryFilters(f: string | undefined): DiscoveryFilters {
  try {
    const bin = atob((f ?? "").replaceAll("-", "+").replaceAll("_", "/"));
    const parsed = discoveryFiltersSchema.safeParse(JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

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
    reassignChain: (b: ReassignRequest): Promise<VerifyResponse> => request("POST", "/v1/auth/reassign", verifyResponseSchema, b),
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

    joinWaitlist: (b: WaitlistJoinRequest): Promise<WaitlistJoinResponse> =>
      request("POST", "/v1/public/waitlist", waitlistJoinResponseSchema, b),
    joinWaitlistByEmail: (b: WaitlistEmailJoinRequest): Promise<WaitlistJoinResponse> =>
      request("POST", "/v1/public/waitlist/email", waitlistJoinResponseSchema, b),
    previewGateLogin: (b: PreviewGateLoginRequest): Promise<PreviewGateLoginResponse> =>
      request("POST", "/v1/preview-gate/login", previewGateLoginResponseSchema, b),

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
    /** Custom roles (ADR-019): built-in matrix plus the organization's own roles. Defining roles is owner-only. */
    listOrganizationRoles: (id: string): Promise<ListRolesResponse> => request("GET", `/v1/organizations/${encodeURIComponent(id)}/roles`, listRolesResponseSchema),
    createOrganizationRole: (id: string, b: CreateCustomRoleRequest): Promise<ListRolesResponse> => request("POST", `/v1/organizations/${encodeURIComponent(id)}/roles`, listRolesResponseSchema, b),
    updateOrganizationRole: (id: string, rid: string, b: UpdateCustomRoleRequest): Promise<ListRolesResponse> =>
      request("PATCH", `/v1/organizations/${encodeURIComponent(id)}/roles/${encodeURIComponent(rid)}`, listRolesResponseSchema, b),
    archiveOrganizationRole: (id: string, rid: string): Promise<ListRolesResponse> => request("POST", `/v1/organizations/${encodeURIComponent(id)}/roles/${encodeURIComponent(rid)}/archive`, listRolesResponseSchema),
    assignMemberCustomRole: (id: string, mid: string, b: AssignCustomRoleRequest): Promise<ListMembersResponse> =>
      request("PUT", `/v1/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(mid)}/custom-role`, listMembersResponseSchema, b),
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

    opsListAssets: (q: OpsAssetListQuery = {}): Promise<OpsAssetListResponse> => request("GET", `/v1/ops/assets?${qs(q)}`, opsAssetListResponseSchema),
    opsCreateAsset: (b: CreateInstrumentRequest): Promise<OpsAssetDetail> => request("POST", "/v1/ops/assets", opsAssetDetailSchema, b),
    opsGetAsset: (id: string): Promise<OpsAssetDetail> => request("GET", `/v1/ops/assets/${e(id)}`, opsAssetDetailSchema),
    /** Logo upload: presign, PUT the file to `uploadUrl` with `headers`, then confirm (the server checks the bytes). */
    opsPresignAssetLogo: (id: string, b: PresignLogoRequest): Promise<PresignFileResponse> => request("POST", `/v1/ops/assets/${e(id)}/logo`, presignFileResponseSchema, b),
    opsConfirmAssetLogo: (id: string, fileId: string): Promise<OpsAssetDetail> => request("POST", `/v1/ops/assets/${e(id)}/logo/${e(fileId)}/confirm`, opsAssetDetailSchema),
    opsRemoveAssetLogo: (id: string): Promise<OpsAssetDetail> => request("DELETE", `/v1/ops/assets/${e(id)}/logo`, opsAssetDetailSchema),
    opsUpdateAsset: (id: string, b: UpdateInstrumentRequest): Promise<OpsAssetDetail> => request("PATCH", `/v1/ops/assets/${e(id)}`, opsAssetDetailSchema, b),
    opsCreateDeployment: (id: string, b: CreateDeploymentRequest): Promise<OpsAssetDetail> => request("POST", `/v1/ops/assets/${e(id)}/deployments`, opsAssetDetailSchema, b),
    opsUpdateDeployment: (id: string, did: string, b: UpdateDeploymentRequest): Promise<OpsAssetDetail> => request("PATCH", `/v1/ops/assets/${e(id)}/deployments/${e(did)}`, opsAssetDetailSchema, b),
    getEligibility: (): Promise<EligibilityResponse> => request("GET", "/v1/me/eligibility", eligibilityResponseSchema),
    declareEligibility: (b: EligibilityDeclarationInput): Promise<EligibilityResponse> => request("POST", "/v1/me/eligibility", eligibilityResponseSchema, b),
    opsSetPermissioned: (id: string, did: string, b: PermissionedRequest): Promise<OpsAssetDetail> => request("PATCH", `/v1/ops/assets/${e(id)}/deployments/${e(did)}/permissioned`, opsAssetDetailSchema, b),
    opsSetFeeOnTransfer: (id: string, did: string, b: FeeOnTransferRequest): Promise<OpsAssetDetail> => request("PATCH", `/v1/ops/assets/${e(id)}/deployments/${e(did)}/fee-on-transfer`, opsAssetDetailSchema, b),
    opsGetRouting: (): Promise<RoutingView> => request("GET", "/v1/ops/routing", routingViewSchema),
    opsDenyRouteTool: (b: RoutePolicyInput): Promise<RoutePolicyEntry> => request("POST", "/v1/ops/routing/deny", routePolicyEntrySchema, b),
    opsAllowRouteTool: (id: string): Promise<RoutePolicyEntry> => request("POST", `/v1/ops/routing/${e(id)}/allow`, routePolicyEntrySchema),
    opsLifiTransfers: (opId: string, legId: string): Promise<LifiTransfers> => request("GET", `/v1/ops/operations/${e(opId)}/legs/${e(legId)}/lifi-transfers`, lifiTransfersSchema),
    opsVerifyDeployment: (id: string, did: string): Promise<OpsAssetDetail> => request("POST", `/v1/ops/assets/${e(id)}/deployments/${e(did)}/verify`, opsAssetDetailSchema),
    opsCreateRoute: (id: string, b: CreateRouteRequest): Promise<OpsAssetDetail> => request("POST", `/v1/ops/assets/${e(id)}/routes`, opsAssetDetailSchema, b),
    opsUpdateRoute: (id: string, rid: string, b: UpdateRouteRequest): Promise<OpsAssetDetail> => request("PATCH", `/v1/ops/assets/${e(id)}/routes/${e(rid)}`, opsAssetDetailSchema, b),
    opsCreateRule: (id: string, b: CreateRuleRequest): Promise<OpsAssetDetail> => request("POST", `/v1/ops/assets/${e(id)}/rules`, opsAssetDetailSchema, b),
    opsUpdateRule: (id: string, ruleId: string, b: UpdateRuleRequest): Promise<OpsAssetDetail> => request("PATCH", `/v1/ops/assets/${e(id)}/rules/${e(ruleId)}`, opsAssetDetailSchema, b),
    opsPutPriceReference: (id: string, kind: "market" | "nav", b: PutPriceReferenceRequest): Promise<OpsAssetDetail> =>
      request("PUT", `/v1/ops/assets/${e(id)}/price-references/${kind}`, opsAssetDetailSchema, b),
    opsRecordNav: (id: string, b: NavEntryRequest): Promise<OpsAssetDetail> => request("POST", `/v1/ops/assets/${e(id)}/nav`, opsAssetDetailSchema, b),
    opsListAssetIssuers: (): Promise<IssuerView[]> => request("GET", "/v1/ops/asset-issuers", issuerViewSchema.array()),
    opsCreateAssetIssuer: (b: IssuerRequest): Promise<IssuerView> => request("POST", "/v1/ops/asset-issuers", issuerViewSchema, b),
    opsUpdateAssetIssuer: (id: string, b: UpdateIssuerRequest): Promise<IssuerView> => request("PATCH", `/v1/ops/asset-issuers/${e(id)}`, issuerViewSchema, b),
    opsListAssetProviders: (): Promise<AssetProviderView[]> => request("GET", "/v1/ops/asset-providers", assetProviderViewSchema.array()),
    opsCreateAssetProvider: (b: AssetProviderRequest): Promise<AssetProviderView> => request("POST", "/v1/ops/asset-providers", assetProviderViewSchema, b),
    opsUpdateAssetProvider: (id: string, b: UpdateAssetProviderRequest): Promise<AssetProviderView> => request("PATCH", `/v1/ops/asset-providers/${e(id)}`, assetProviderViewSchema, b),

    opsSubmitAsset: (id: string): Promise<OpsAssetDetail> => request("POST", `/v1/ops/assets/${e(id)}/submit`, opsAssetDetailSchema),
    opsDecideAsset: (id: string, b: AssetDecisionRequest): Promise<OpsAssetDetail> => request("POST", `/v1/ops/assets/${e(id)}/decision`, opsAssetDetailSchema, b),
    opsAssetAction: (id: string, action: "activate" | "pause" | "resume" | "deprecate" | "retire"): Promise<OpsAssetDetail> =>
      request("POST", `/v1/ops/assets/${e(id)}/${action}`, opsAssetDetailSchema),
    opsAssetItemAction: (id: string, kind: "deployments" | "routes", itemId: string, action: "approve" | "activate" | "pause" | "resume" | "retire"): Promise<OpsAssetDetail> =>
      request("POST", `/v1/ops/assets/${e(id)}/${kind}/${e(itemId)}/${action}`, opsAssetDetailSchema),
    opsGetAssetPrices: (id: string): Promise<PriceView[]> => request("GET", `/v1/ops/assets/${e(id)}/prices`, priceViewSchema.array()),

    listAssets: (q: AssetListQuery = {}): Promise<PublicAssetListResponse> => request("GET", `/v1/assets?${qs(q)}`, publicAssetListResponseSchema),
    getAsset: (id: string): Promise<PublicAssetDetail> => request("GET", `/v1/assets/${e(id)}`, publicAssetDetailSchema),

    createBasket: (orgId: string, b: CreateBasketRequest): Promise<BasketDetail> => request("POST", `/v1/organizations/${e(orgId)}/baskets`, basketDetailSchema, b),
    listOrgBaskets: (orgId: string, q: ListBasketsQuery = {}): Promise<ListBasketsResponse> => request("GET", `/v1/organizations/${e(orgId)}/baskets?${qs(q)}`, listBasketsResponseSchema),
    getBasket: (bid: string): Promise<BasketDetail> => request("GET", `/v1/baskets/${e(bid)}`, basketDetailSchema),
    /** Basket draft files: presign, PUT to `uploadUrl`, confirm with a title and kind; remove unlinks from the draft. */
    presignBasketFile: (bid: string, b: PresignBasketFileRequest): Promise<PresignFileResponse> => request("POST", `/v1/baskets/${e(bid)}/draft/files`, presignFileResponseSchema, b),
    confirmBasketFile: (bid: string, fileId: string, b: ConfirmBasketFileRequest): Promise<BasketDetail> => request("POST", `/v1/baskets/${e(bid)}/draft/files/${e(fileId)}/confirm`, basketDetailSchema, b),
    removeBasketFile: (bid: string, linkId: string): Promise<BasketDetail> => request("DELETE", `/v1/baskets/${e(bid)}/draft/files/${e(linkId)}`, basketDetailSchema),
    saveBasketDraft: (bid: string, b: SaveBasketDraftRequest): Promise<BasketDetail> => request("PATCH", `/v1/baskets/${e(bid)}/draft`, basketDetailSchema, b),
    validateBasket: (bid: string): Promise<BasketValidation> => request("POST", `/v1/baskets/${e(bid)}/validate`, basketValidationSchema),
    previewBasket: (bid: string): Promise<BasketPreview> => request("GET", `/v1/baskets/${e(bid)}/preview`, basketPreviewSchema),
    createBasketVersion: (bid: string): Promise<BasketDetail> => request("POST", `/v1/baskets/${e(bid)}/versions`, basketDetailSchema),
    listBasketVersions: (bid: string): Promise<ListBasketVersionsResponse> => request("GET", `/v1/baskets/${e(bid)}/versions`, listBasketVersionsResponseSchema),
    getBasketVersionDiff: (bid: string, vid: string): Promise<BasketDiff> => request("GET", `/v1/baskets/${e(bid)}/versions/${e(vid)}/diff`, basketDiffSchema),
    addBasketAssignment: (bid: string, b: CreateAssignmentRequest): Promise<BasketDetail> => request("POST", `/v1/baskets/${e(bid)}/assignments`, basketDetailSchema, b),
    updateBasketAssignment: (bid: string, aid: string, b: UpdateAssignmentRequest): Promise<BasketDetail> => request("PATCH", `/v1/baskets/${e(bid)}/assignments/${e(aid)}`, basketDetailSchema, b),
    endBasketAssignment: (bid: string, aid: string, b: EndAssignmentRequest): Promise<BasketDetail> => request("POST", `/v1/baskets/${e(bid)}/assignments/${e(aid)}/end`, basketDetailSchema, b),

    submitBasket: (bid: string): Promise<BasketDetail> => request("POST", `/v1/baskets/${e(bid)}/submit`, basketDetailSchema),
    withdrawBasket: (bid: string): Promise<BasketDetail> => request("POST", `/v1/baskets/${e(bid)}/withdraw`, basketDetailSchema),
    publishBasket: (bid: string): Promise<BasketDetail> => request("POST", `/v1/baskets/${e(bid)}/publish`, basketDetailSchema),
    pauseBasket: (bid: string, b: BasketReasonRequest): Promise<BasketDetail> => request("POST", `/v1/baskets/${e(bid)}/pause`, basketDetailSchema, b),
    resumeBasket: (bid: string): Promise<BasketDetail> => request("POST", `/v1/baskets/${e(bid)}/resume`, basketDetailSchema),
    requestBasketRetirement: (bid: string, b: BasketReasonRequest): Promise<BasketDetail> => request("POST", `/v1/baskets/${e(bid)}/retirement-request`, basketDetailSchema, b),

    opsListBaskets: (q: Partial<ListOpsBasketsQuery> = {}): Promise<OpsBasketListResponse> => request("GET", `/v1/ops/baskets?${qs(q)}`, opsBasketListResponseSchema),
    opsGetBasket: (bid: string): Promise<OpsBasketDetail> => request("GET", `/v1/ops/baskets/${e(bid)}`, opsBasketDetailSchema),
    opsDecideBasketVersion: (bid: string, vid: string, b: BasketReviewDecisionRequest): Promise<OpsBasketDetail> =>
      request("POST", `/v1/ops/baskets/${e(bid)}/versions/${e(vid)}/decision`, opsBasketDetailSchema, b),
    opsDecideBasketLead: (bid: string, aid: string, b: BasketApprovalRequest): Promise<OpsBasketDetail> =>
      request("POST", `/v1/ops/baskets/${e(bid)}/assignments/${e(aid)}/decision`, opsBasketDetailSchema, b),
    opsPauseBasket: (bid: string, b: BasketReasonRequest): Promise<OpsBasketDetail> => request("POST", `/v1/ops/baskets/${e(bid)}/pause`, opsBasketDetailSchema, b),
    opsResumeBasket: (bid: string): Promise<OpsBasketDetail> => request("POST", `/v1/ops/baskets/${e(bid)}/resume`, opsBasketDetailSchema),
    opsRetireBasket: (bid: string, b: BasketReasonRequest): Promise<OpsBasketDetail> => request("POST", `/v1/ops/baskets/${e(bid)}/retire`, opsBasketDetailSchema, b),
    opsDecideBasketRetirement: (bid: string, b: BasketApprovalRequest): Promise<OpsBasketDetail> => request("POST", `/v1/ops/baskets/${e(bid)}/retirement/decision`, opsBasketDetailSchema, b),
    opsListDisclosureTemplates: (): Promise<ListDisclosureTemplatesResponse> => request("GET", "/v1/ops/disclosure-templates", listDisclosureTemplatesResponseSchema),
    opsCreateDisclosureTemplate: (b: CreateDisclosureTemplateRequest): Promise<ListDisclosureTemplatesResponse> => request("POST", "/v1/ops/disclosure-templates", listDisclosureTemplatesResponseSchema, b),
    opsRetireDisclosureTemplate: (id: string): Promise<ListDisclosureTemplatesResponse> => request("POST", `/v1/ops/disclosure-templates/${e(id)}/retire`, listDisclosureTemplatesResponseSchema),

    listPublicBaskets: (cursor?: string): Promise<PublicBasketListResponse> => request("GET", `/v1/public/baskets?${qs({ cursor })}`, publicBasketListResponseSchema),
    getPublicBasket: (slug: string): Promise<PublicBasketResponse> => request("GET", `/v1/public/baskets/${e(slug)}`, publicBasketResponseSchema),

    createBitcoinChallenge: (b: BitcoinChallengeRequest): Promise<BitcoinChallengeResponse> => request("POST", "/v1/me/chain-accounts/bitcoin/challenge", bitcoinChallengeResponseSchema, b),
    verifyBitcoin: (b: BitcoinVerify): Promise<VerifyResponse> => request("POST", "/v1/me/chain-accounts/bitcoin/verify", verifyResponseSchema, b),
    investPlan: (b: InvestRequest): Promise<OperationView> => request("POST", "/v1/operations/invest", operationSchema, b),
    sellPlan: (b: SellRequest): Promise<OperationView> => request("POST", "/v1/operations/sell", operationSchema, b),
    /** A plan to sign, or `{ aligned: true }` when nothing needs trading (the version was recorded). */
    rebalance: (b: RebalanceRequest): Promise<OperationView | { aligned: true }> => request("POST", "/v1/operations/rebalance", rebalanceResponseSchema, b),
    repair: (b: RepairRequest): Promise<OperationView> => request("POST", "/v1/operations/repair", operationSchema, b),
    skipVersion: (positionId: string, b: SkipRequest): Promise<void> => request<z.ZodVoid>("POST", `/v1/positions/${e(positionId)}/skip`, null, b),
    keepCustom: (positionId: string): Promise<void> => request<z.ZodVoid>("POST", `/v1/positions/${e(positionId)}/custom`, null),
    revertCustom: (positionId: string): Promise<void> => request<z.ZodVoid>("POST", `/v1/positions/${e(positionId)}/custom/revert`, null),
    sync: (b: SyncRequest): Promise<SyncResult> => request("POST", "/v1/portfolio/sync", syncResultSchema, b),
    notifications: (q: { cursor?: string; limit?: number } = {}): Promise<NotificationsPage> => request("GET", `/v1/me/notifications?${qs({ cursor: q.cursor, limit: q.limit?.toString() })}`, notificationsPageSchema),
    markNotificationsRead: (b: { ids: string[] } | { all: true }): Promise<void> => request<z.ZodVoid>("POST", "/v1/me/notifications/read", null, b),
    registerPushToken: (b: PushToken): Promise<void> => request<z.ZodVoid>("POST", "/v1/me/push-tokens", null, b),
    revokePushToken: (token: string): Promise<void> => request<z.ZodVoid>("POST", "/v1/me/push-tokens/revoke", null, { token }),
    basketAdoption: (basketId: string): Promise<Adoption> => request("GET", `/v1/baskets/${e(basketId)}/adoption`, adoptionSchema),
    getOperation: (id: string): Promise<OperationView> => request("GET", `/v1/operations/${e(id)}`, operationSchema),
    quoteLeg: (id: string, legId: string): Promise<LegQuoteResponse> => request("POST", `/v1/operations/${e(id)}/legs/${e(legId)}/quote`, legQuoteResponseSchema),
    submitLeg: (id: string, legId: string, b: LegSubmit): Promise<OperationView> => request("POST", `/v1/operations/${e(id)}/legs/${e(legId)}/submit`, operationSchema, b),
    cancelOperation: (id: string): Promise<OperationView> => request("POST", `/v1/operations/${e(id)}/cancel`, operationSchema),
    getPortfolio: (): Promise<Portfolio> => request("GET", "/v1/portfolio", portfolioSchema),
    leavePosition: (id: string): Promise<void> => request<z.ZodVoid>("POST", `/v1/positions/${e(id)}/leave`, null),
    closePosition: (id: string): Promise<void> => request<z.ZodVoid>("POST", `/v1/positions/${e(id)}/close`, null),
    getInvestability: (slug: string): Promise<Investability> => request("GET", `/v1/baskets/${e(slug)}/investability`, investabilitySchema),

    /** Filters travel as one `f` param: base64url JSON (exact round-trip; the cursor stays its own param). */
    discoverBaskets: ({ cursor, ...filters }: DiscoveryFilters = {}): Promise<DiscoverySearchResponse> =>
      request("GET", `/v1/public/discovery/baskets?${qs({ f: encodeDiscoveryFilters(filters), cursor })}`, discoverySearchResponseSchema),
    /** Featured (ops-curated) and trending baskets for the home and discovery rails. */
    getDiscoveryCollections: (): Promise<DiscoveryCollectionsResponse> => request("GET", "/v1/public/discovery/collections", discoveryCollectionsResponseSchema),
    getSuggestedBaskets: (): Promise<SuggestedBasketsResponse> => request("GET", "/v1/me/discovery/suggested", suggestedBasketsResponseSchema),
    opsSetBasketFeatured: (basketId: string, b: SetBasketFeaturedRequest): Promise<SetBasketFeaturedResponse> =>
      request("PUT", `/v1/ops/baskets/${e(basketId)}/featured`, setBasketFeaturedResponseSchema, b),
    aiSearchBaskets: (query: string): Promise<AiSearchResponse> => request("POST", "/v1/public/discovery/ai-search", aiSearchResponseSchema, { query }),
    getPublicManager: (handle: string): Promise<PublicManager> => request("GET", `/v1/public/managers/${e(handle)}`, publicManagerSchema),
    getMyManagerProfile: (): Promise<OwnManagerProfileResponse> => request("GET", "/v1/me/manager-profile", ownManagerProfileResponseSchema),
    saveMyManagerProfile: (b: ManagerProfileRequest): Promise<OwnManagerProfileResponse> => request("PUT", "/v1/me/manager-profile", ownManagerProfileResponseSchema, b),
    publishMyManagerProfile: (): Promise<OwnManagerProfileResponse> => request("POST", "/v1/me/manager-profile/publish", ownManagerProfileResponseSchema),
    unpublishMyManagerProfile: (): Promise<OwnManagerProfileResponse> => request("POST", "/v1/me/manager-profile/unpublish", ownManagerProfileResponseSchema),
    opsListAssetTags: (): Promise<ListAssetTagsResponse> => request("GET", "/v1/ops/asset-tags", listAssetTagsResponseSchema),
    opsCreateAssetTag: (b: CreateAssetTagRequest): Promise<AssetTagView> => request("POST", "/v1/ops/asset-tags", assetTagViewSchema, b),
    opsRetireAssetTag: (id: string): Promise<AssetTagView> => request("POST", `/v1/ops/asset-tags/${e(id)}/retire`, assetTagViewSchema),
    opsListManagerProfiles: (q: Partial<ListOpsManagerProfilesQuery> = {}): Promise<ListOpsManagerProfilesResponse> => request("GET", `/v1/ops/manager-profiles?${qs(q)}`, listOpsManagerProfilesResponseSchema),
    opsHideManagerProfile: (id: string, b: HideManagerProfileRequest): Promise<ManagerProfileView> => request("POST", `/v1/ops/manager-profiles/${e(id)}/hide`, managerProfileViewSchema, b),
    opsUnhideManagerProfile: (id: string): Promise<ManagerProfileView> => request("POST", `/v1/ops/manager-profiles/${e(id)}/unhide`, managerProfileViewSchema),

    getPublicFees: (): Promise<PublicFees> => request("GET", "/v1/public/fees", publicFeesSchema),
    getEarnings: (orgId: string, q: Omit<EarningsQuery, "format"> = {}): Promise<Earnings> => request("GET", `/v1/organizations/${e(orgId)}/earnings?${qs(q)}`, earningsSchema),
    opsListFees: (): Promise<PlatformFeeList> => request("GET", "/v1/ops/fees", platformFeeListSchema),
    opsSaveFee: (b: PlatformFeeScheduleInput): Promise<PlatformFeeScheduleView> => request("POST", "/v1/ops/fees", platformFeeScheduleViewSchema, b),
    opsListFeeOverrides: (): Promise<PlatformFeeList> => request("GET", "/v1/ops/fees/overrides", platformFeeListSchema),
    opsSaveFeeOverride: (b: PlatformFeeOverrideInput): Promise<PlatformFeeScheduleView> => request("POST", "/v1/ops/fees/overrides", platformFeeScheduleViewSchema, b),
    opsEndFeeOverride: (id: string): Promise<PlatformFeeScheduleView> => request("POST", `/v1/ops/fees/overrides/${e(id)}/end`, platformFeeScheduleViewSchema),
    opsGetRevenue: (q: Omit<EarningsQuery, "format"> = {}): Promise<Revenue> => request("GET", `/v1/ops/revenue?${qs(q)}`, revenueSchema),
    opsListRoles: (): Promise<PlatformRolesResponse> => request("GET", "/v1/ops/roles", platformRolesResponseSchema),
    opsGrantRole: (b: GrantRoleRequest): Promise<PlatformRoleView> => request("POST", "/v1/ops/roles", platformRoleViewSchema, b),
    opsRevokeRole: (id: string): Promise<void> => request<z.ZodVoid>("DELETE", `/v1/ops/roles/${encodeURIComponent(id)}`, null),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
