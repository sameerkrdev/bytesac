import { describe, expect, it } from "vitest";
import { chainFromCaip, isUserRejection } from "./wallet.js";

describe("chainFromCaip", () => {
  it("maps supported networks", () => {
    expect(chainFromCaip("eip155:1")).toBe("ethereum");
    expect(chainFromCaip("eip155:8453")).toBe("base");
    expect(chainFromCaip("eip155:56")).toBe("bnb");
    expect(chainFromCaip("eip155:42161")).toBe("arbitrum");
    expect(chainFromCaip("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toBe("solana");
  });
  it("flags unsupported and missing networks", () => {
    expect(chainFromCaip("eip155:137")).toBe("unsupported");
    expect(chainFromCaip("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")).toBe("unsupported");
    expect(chainFromCaip(undefined)).toBeNull();
  });
});

describe("isUserRejection", () => {
  it("detects EIP-1193 4001 and named rejections", () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection({ name: "UserRejectedRequestError" })).toBe(true);
    expect(isUserRejection(new Error("User rejected the request."))).toBe(true);
    expect(isUserRejection(new Error("timeout"))).toBe(false);
    expect(isUserRejection(new Error("signing failed"))).toBe(false);
    expect(isUserRejection({ name: "WalletSignMessageError" })).toBe(false);
  });
});
