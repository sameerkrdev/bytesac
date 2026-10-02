import { describe, expect, it } from "vitest";
import {
  MEMBERSHIP_STATUSES, MEMBERSHIP_TRANSITIONS, ORGANIZATION_PERMISSIONS, REVIEWED_ROLES, ROLE_PERMISSIONS,
  changeRoleRequestSchema, inviteMemberRequestSchema, membershipProfileRequestSchema, type MembershipRole, type OrganizationPermission,
} from "./index";

const WALLET = { walletChain: "base", walletAddress: "0x" + "ab".repeat(20), email: "New@Example.com" } as const;

describe("ROLE_PERMISSIONS", () => {
  // Spec 4 section 4 table, one row per permission.
  const table: Record<OrganizationPermission, MembershipRole[]> = {
    "org.read": ["OWNER", "ADMIN", "MANAGER", "ANALYST", "VIEWER"],
    "org.edit": ["OWNER"],
    "payout.manage": ["OWNER"],
    "members.manage": ["OWNER", "ADMIN"],
    "members.manage_admins": ["OWNER"],
    "analytics.read": ["OWNER", "ADMIN", "MANAGER", "ANALYST"],
    "baskets.manage": ["OWNER", "ADMIN", "MANAGER"],
    "earnings.read": ["OWNER", "ADMIN"],
  };
  it("matches the spec table", () => {
    for (const permission of ORGANIZATION_PERMISSIONS) {
      const roles = (Object.keys(ROLE_PERMISSIONS) as MembershipRole[]).filter((r) => ROLE_PERMISSIONS[r].includes(permission));
      expect(roles.sort(), permission).toEqual([...table[permission]].sort());
    }
  });
});

describe("lifecycle", () => {
  it("terminal states have no way out and every target is a known status", () => {
    expect(MEMBERSHIP_TRANSITIONS.REJECTED).toEqual([]);
    expect(MEMBERSHIP_TRANSITIONS.REVOKED).toEqual([]);
    for (const tos of Object.values(MEMBERSHIP_TRANSITIONS)) for (const to of tos) expect(MEMBERSHIP_STATUSES).toContain(to);
    expect(MEMBERSHIP_TRANSITIONS.INVITED).not.toContain("UNDER_REVIEW");
  });
  it("only ADMIN and MANAGER are reviewed", () => {
    expect(REVIEWED_ROLES).toEqual(["ADMIN", "MANAGER"]);
  });
});

describe("inviteMemberRequestSchema", () => {
  it("accepts every invitable role and lowercases the email", () => {
    for (const role of ["ADMIN", "MANAGER", "ANALYST", "VIEWER"]) expect(inviteMemberRequestSchema.safeParse({ ...WALLET, role }).success).toBe(true);
    expect(inviteMemberRequestSchema.parse({ ...WALLET, role: "VIEWER" }).email).toBe("new@example.com");
  });
  it("rejects OWNER, a missing email and unknown keys", () => {
    expect(inviteMemberRequestSchema.safeParse({ ...WALLET, role: "OWNER" }).success).toBe(false);
    expect(inviteMemberRequestSchema.safeParse({ walletChain: "base", walletAddress: WALLET.walletAddress, role: "VIEWER" }).success).toBe(false);
    expect(inviteMemberRequestSchema.safeParse({ ...WALLET, role: "VIEWER", extra: 1 }).success).toBe(false);
  });
  it("changeRoleRequestSchema rejects OWNER", () => {
    expect(changeRoleRequestSchema.safeParse({ role: "OWNER" }).success).toBe(false);
  });
});

describe("membershipProfileRequestSchema", () => {
  it("accepts names, nulls that clear, and omitted keys", () => {
    expect(membershipProfileRequestSchema.parse({ publicDisplayName: "  Ada L.  ", publicTitle: "CIO" })).toEqual({ publicDisplayName: "Ada L.", publicTitle: "CIO" });
    expect(membershipProfileRequestSchema.parse({ publicDisplayName: null, publicTitle: null })).toEqual({ publicDisplayName: null, publicTitle: null });
    expect(membershipProfileRequestSchema.parse({})).toEqual({});
  });
  it("enforces 2-80 and 80 character limits", () => {
    expect(membershipProfileRequestSchema.safeParse({ publicDisplayName: "A" }).success).toBe(false);
    expect(membershipProfileRequestSchema.safeParse({ publicDisplayName: "A".repeat(81) }).success).toBe(false);
    expect(membershipProfileRequestSchema.safeParse({ publicTitle: "T".repeat(81) }).success).toBe(false);
  });
});
