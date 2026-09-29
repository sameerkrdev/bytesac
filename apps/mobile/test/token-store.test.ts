import * as SecureStore from "expo-secure-store";
import { tokenStore, __resetTokenCache } from "@/lib/token-store";

beforeEach(() => {
  __resetTokenCache();
  (SecureStore as unknown as { __store: Map<string, string> }).__store.clear();
  jest.clearAllMocks();
});

describe("tokenStore", () => {
  it("round-trips via SecureStore key bytesac.session", async () => {
    await tokenStore.set("abc");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("bytesac.session", "abc");
    __resetTokenCache();
    expect(await tokenStore.get()).toBe("abc");
    await tokenStore.clear();
    expect(await tokenStore.get()).toBeNull();
  });
  it("rotation replaces the token (new value visible immediately)", async () => {
    await tokenStore.set("old");
    await tokenStore.set("new");
    expect(await tokenStore.get()).toBe("new");
  });
  it("never throws when the keychain is unavailable", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error("keychain locked"));
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await tokenStore.get()).toBeNull();
  });
  it("an in-flight get() cannot resurrect a token cleared meanwhile", async () => {
    await tokenStore.set("stale");
    __resetTokenCache();
    let release!: () => void;
    (SecureStore.getItemAsync as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve("stale"); }),
    );
    const pending = tokenStore.get();
    await tokenStore.clear();
    release();
    expect(await pending).toBeNull();
    expect(await tokenStore.get()).toBeNull();
  });
});
