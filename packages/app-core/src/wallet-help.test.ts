import { describe, expect, it } from "vitest";
import { WALLET_HELP } from "./wallet-help";

describe("WALLET_HELP", () => {
  it("covers the eight wallet topics from the spec", () => {
    expect(WALLET_HELP.map((h) => h.id)).toEqual(["several-wallets", "move-chain", "wrong-wallet", "metamask-solana", "import-phrase", "lost-wallet", "cannot-sign-chain", "per-step-approval"]);
    expect(WALLET_HELP.find((h) => h.id === "import-phrase")!.answer.join(" ")).toContain("same address");
  });
});
