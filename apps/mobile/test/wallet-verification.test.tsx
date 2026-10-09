import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { WalletVerification } from "@/components/auth/wallet-verification";
import { api } from "@/lib/api";

const OLD = "0xAbC0000000000000000000000000000000000001";
const NEW = "0xDeF0000000000000000000000000000000000002";
const mockWallet = {
  account: null as { chain: "base"; address: string; walletName: string } | null,
  network: "supported",
  signMessage: jest.fn(),
  disconnect: jest.fn(async () => undefined),
  connect: jest.fn(),
};
jest.mock("@/lib/wallet/use-wallet-connector", () => ({ useWalletConnector: () => ({ ...mockWallet, chooseNetwork: jest.fn(), switchToSupported: jest.fn() }) }));
jest.mock("@/lib/auth-context", () => ({ useAuth: () => ({ acceptToken: jest.fn(async () => undefined), signOut: jest.fn() }) }));
jest.mock("@/lib/api", () => ({ api: { createChallenge: jest.fn(), reassignChain: jest.fn(), verify: jest.fn() } }));

const linked = [{ chain: "base" as const, chainFamily: "evm" as const, address: OLD.toLowerCase(), status: "active" as const, walletName: "MetaMask", verificationMethod: "eoa_ecdsa" as const, verifiedAt: "2026-09-29T00:00:00.000Z" }];
const ui = () => <WalletVerification purpose="reassign_chain" linkedAddresses={linked} reassign={{ chain: "base", previous: { address: OLD.toLowerCase(), walletName: "MetaMask" } }} onVerified={jest.fn()} />;

describe("WalletVerification, moving a chain (mobile)", () => {
  it("new wallet signs, the app hands over to the current wallet, which can then sign (Sign stays enabled) and the move posts both signatures", async () => {
    (api.createChallenge as jest.Mock).mockResolvedValue({ challengeId: "c1", message: "msg" });
    (api.reassignChain as jest.Mock).mockResolvedValue({ token: "t", isNewUser: false });
    mockWallet.signMessage.mockResolvedValueOnce("sigNew").mockResolvedValueOnce("sigOld");
    mockWallet.account = { chain: "base", address: NEW, walletName: "Rabby" };
    const { rerender } = await render(ui());
    await fireEvent.press(screen.getByRole("button", { name: "Sign message" }));
    expect(await screen.findByText(/Now approve in MetaMask/)).toBeOnTheScreen();
    await waitFor(() => expect(mockWallet.connect).toHaveBeenCalled());
    expect(mockWallet.disconnect).toHaveBeenCalledWith("eip155");
    mockWallet.account = { chain: "base", address: OLD.toLowerCase(), walletName: "MetaMask" };
    await act(async () => { rerender(ui()); });
    expect(screen.getByRole("button", { name: "Sign message" })).toBeEnabled();
    await fireEvent.press(screen.getByRole("button", { name: "Sign message" }));
    await waitFor(() => expect(api.reassignChain).toHaveBeenCalledWith(expect.objectContaining({ challengeId: "c1", signature: "sigNew", previousSignature: "sigOld", client: "mobile" })));
  });
});
