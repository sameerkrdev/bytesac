import { and, eq, isNull, ne } from "drizzle-orm";
import createHttpError from "http-errors";
import { contacts, db, investmentWallets, userPermissions, users } from "@repo/db";
import { familyOf, type AssetChain, type MeResponse } from "@repo/validator";
import { contactView } from "@/modules/contacts/contacts.service";
import { listMyOrganizations } from "@/modules/organizations/organizations.service";
import { activeRoles } from "@/modules/manager-applications/platform-roles.service";
import { addressesForWallet } from "@/modules/auth/wallets.service";

/** The signed-in user's account: wallet addresses, contacts, permissions, platform roles and organizations. */
export async function getMe(userId: string): Promise<MeResponse> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const [wallet] = await db.select({ id: investmentWallets.id, walletProvider: investmentWallets.walletProvider }).from(investmentWallets)
    .where(and(eq(investmentWallets.userId, userId), eq(investmentWallets.status, "active")));
  if (!user || !wallet) throw createHttpError("This account is not active", { code: "USER_NOT_ACTIVE" });
  const addresses = await addressesForWallet(db, wallet.id);
  const current = await db.select().from(contacts).where(and(eq(contacts.userId, userId), ne(contacts.status, "replaced")));
  return {
    user: { id: user.id, status: user.status, createdAt: user.createdAt.toISOString() },
    wallet: {
      id: wallet.id,
      walletProvider: wallet.walletProvider,
      addresses: addresses.map((a) => ({
        chain: a.chain, chainFamily: familyOf(a.chain), address: a.address, status: a.status,
        verificationMethod: a.verificationMethod, verifiedAt: a.verifiedAt.toISOString(),
        signableChains: (a.signableChains as AssetChain[] | null) ?? null,
        walletName: a.walletName ?? null,
      })),
    },
    contacts: current.map(contactView),
    permissions: (await db.select({ permission: userPermissions.permission }).from(userPermissions).where(and(eq(userPermissions.userId, userId), isNull(userPermissions.revokedAt)))).map((p) => p.permission),
    platformRoles: await activeRoles(db, userId),
    organizations: (await listMyOrganizations(userId)).organizations.map((o) => ({ id: o.id, displayName: o.displayName, role: o.role, status: o.status, membershipId: o.membershipId, membershipStatus: o.membershipStatus })),
  };
}
