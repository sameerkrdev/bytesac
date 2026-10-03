import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { verifySolanaSignature } from "@/services/signatures";

// RFC 8032 section 7.1, TEST 1 (empty message): fixed vector produced by an independent implementation.
const PUBLIC_KEY = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const SIGNATURE = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
const address = bs58.encode(Buffer.from(PUBLIC_KEY, "hex"));
const signature = bs58.encode(Buffer.from(SIGNATURE, "hex"));

describe("verifySolanaSignature against RFC 8032 test 1", () => {
  it("accepts the published signature over the empty message", () => {
    expect(verifySolanaSignature({ address, message: "", signature })).toEqual({ kind: "valid", method: "ed25519" });
  });
  it("rejects the same signature over another message", () => {
    expect(verifySolanaSignature({ address, message: "x", signature })).toEqual({ kind: "invalid" });
  });
});
