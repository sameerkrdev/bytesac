import type { MeResponse } from "@repo/validator";
import { ORGS } from "./catalog";

export type Persona = "investor" | "manager" | "ops" | "new";

const t = "2026-09-29T09:00:00.000Z";
const base = (): MeResponse => ({
  user: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", status: "active", createdAt: t },
  wallet: {
    id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e50", walletProvider: "Phantom",
    addresses: [
      { chain: "solana", chainFamily: "solana", address: "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2", status: "active", verificationMethod: "ed25519", verifiedAt: t },
      { chain: "ethereum", chainFamily: "evm", address: "0x8ba1f109551bD432803012645Ac136ddd64DBA72", status: "active", verificationMethod: "eoa_ecdsa", verifiedAt: t },
    ],
  },
  contacts: [
    { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e51", type: "email", value: "investor@example.com", status: "verified", verifiedAt: t },
    { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e52", type: "phone", value: "+44 7700 900123", status: "verified", verifiedAt: t },
  ],
  permissions: [], platformRoles: [], organizations: [],
});

export function meFor(p: Persona): MeResponse {
  const me = base();
  if (p === "new") return { ...me, contacts: [], wallet: { ...me.wallet, addresses: me.wallet.addresses.slice(0, 1) } };
  if (p === "manager") me.organizations = [{ id: ORGS.meridian.id, displayName: ORGS.meridian.displayName, role: "OWNER", status: "VERIFIED", membershipId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70", membershipStatus: "ACTIVE" }];
  if (p === "ops") me.platformRoles = ["ops_admin"];
  return me;
}
