import { act, render, screen, waitFor } from "@testing-library/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Text } from "react-native";
import { api } from "@/lib/api";
import { ApiError } from "@repo/api-client";
import { AuthProvider, createAppQueryClient, useAuth } from "@/lib/auth-context";
import { tokenStore, __resetTokenCache } from "@/lib/token-store";

function Probe() {
  const a = useAuth();
  return <Text testID="s">{`${a.status}:${a.expired}`}</Text>;
}

beforeEach(async () => {
  __resetTokenCache();
  await tokenStore.clear();
  jest.restoreAllMocks();
});

describe("AuthProvider", () => {
  it("boots signedOut without a token and signedIn with one", async () => {
    const r = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("signedOut:false"));
    await r.unmount();
    await tokenStore.set("t");
    await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("signedIn:false"));
  });

  it("signOut({ expired }) clears the token and flags expiry", async () => {
    await tokenStore.set("t");
    let ctx: ReturnType<typeof useAuth> | null = null;
    function Grab() {
      ctx = useAuth();
      return null;
    }
    await render(<AuthProvider><Grab /><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("signedIn:false"));
    await act(async () => {
      await ctx!.signOut({ expired: true });
    });
    expect(screen.getByTestId("s")).toHaveTextContent("signedOut:true");
    expect(await tokenStore.get()).toBeNull();
  });

  it("signOut clears the query cache", async () => {
    await tokenStore.set("t");
    let ctx: ReturnType<typeof useAuth> | null = null;
    let qc: ReturnType<typeof useQueryClient> | null = null;
    function Grab() {
      ctx = useAuth();
      qc = useQueryClient();
      return null;
    }
    await render(<AuthProvider><Grab /><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("signedIn:false"));
    qc!.setQueryData(["me"], { id: 1 });
    await act(async () => {
      await ctx!.signOut();
    });
    expect(qc!.getQueryData(["me"])).toBeUndefined();
  });

  it("explicit logout disconnects the wallet but a hung disconnect cannot stall it", async () => {
    jest.useFakeTimers();
    try {
      jest.spyOn(api, "logout").mockResolvedValue(undefined);
      await tokenStore.set("t");
      const disconnectWallet = jest.fn(() => new Promise<void>(() => undefined));
      let ctx: ReturnType<typeof useAuth> | null = null;
      function Grab() {
        ctx = useAuth();
        return null;
      }
      await render(<AuthProvider disconnectWallet={disconnectWallet}><Grab /><Probe /></AuthProvider>);
      await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("signedIn:false"));
      let done = false;
      await act(async () => {
        void ctx!.signOut({ remote: true }).then(() => {
          done = true;
        });
        await jest.advanceTimersByTimeAsync(3100);
      });
      expect(disconnectWallet).toHaveBeenCalled();
      expect(done).toBe(true);
      expect(screen.getByTestId("s")).toHaveTextContent("signedOut:false");
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("createAppQueryClient", () => {
  it("signs out on SESSION_EXPIRED query errors only", async () => {
    const onExpired = jest.fn();
    const qc = createAppQueryClient(onExpired);
    await qc.fetchQuery({ queryKey: ["a"], queryFn: () => Promise.reject(new ApiError("VALIDATION_FAILED", 400, "x")), retry: false }).catch(() => undefined);
    expect(onExpired).not.toHaveBeenCalled();
    await qc.fetchQuery({ queryKey: ["b"], queryFn: () => Promise.reject(new ApiError("SESSION_EXPIRED", 401, "x")), retry: false }).catch(() => undefined);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
