import { redirectSystemPath } from "@/app/+native-intent";

const r = (path: string, initial = false) => redirectSystemPath({ path, initial });

describe("redirectSystemPath", () => {
  it.each([
    "bytesac://?data=abc&nonce=n",
    "bytesac:///?errorCode=-32000&errorMessage=x",
    "bytesac:///?wc=1",
    "bytesac://?phantom_encryption_public_key=k&data=d&nonce=n",
    "wc:abcdef@2?relay-protocol=irn",
    "wc://x",
    "/?data=abc&nonce=n",
  ])("does not navigate for wallet return %s", (p) => {
    expect(r(p)).toBeNull();
    expect(r(p, true)).toBeNull();
  });

  it.each([
    "bytesac://",
    "bytesac:///",
    "bytesac://home",
    "bytesac://home?data=1",
    "bytesac://?utm=1",
    "/(app)/profile",
    "/",
    "https://example.com/?data=1",
  ])("passes other path %s through", (p) => {
    expect(r(p)).toBe(p);
  });
});
