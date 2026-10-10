import { ApiError } from "@repo/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import PreviewAccessScreen from "@/app/(auth)/preview-access";
import { api } from "@/lib/api";
import { previewToken, withPreviewGate } from "@/lib/preview-gate";
import { apiMock, renderWithClient, resetApi } from "./helpers";

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock("expo-router", () => ({ get router() { return mockRouter; }, useRouter: () => mockRouter }));
jest.mock("@/lib/api", () => ({ api: require("./helpers").apiMock() }));
const mockApi = api as unknown as ReturnType<typeof apiMock>;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(async () => {
  resetApi(mockApi);
  jest.clearAllMocks();
  (SecureStore as unknown as { __store: Map<string, string> }).__store.clear();
  await previewToken.clear();
});

describe("withPreviewGate", () => {
  it("sends the stored token as X-Preview-Token", async () => {
    await previewToken.set("gate-token");
    const inner = jest.fn().mockResolvedValue(json(200, { ok: true }));
    await withPreviewGate(inner)("http://api/v1/me", { headers: { Authorization: "Bearer s" } });
    const headers = inner.mock.calls[0][1].headers as Headers;
    expect(headers.get("X-Preview-Token")).toBe("gate-token");
    expect(headers.get("Authorization")).toBe("Bearer s");
  });

  it("on PREVIEW_GATE_REQUIRED clears the token, opens the login and does not hand back a 401", async () => {
    await previewToken.set("expired");
    const inner = jest.fn().mockResolvedValue(json(401, { error: { code: "PREVIEW_GATE_REQUIRED", message: "x" } }));
    await expect(withPreviewGate(inner)("http://api/v1/me")).rejects.toThrow(TypeError);
    expect(mockRouter.replace).toHaveBeenCalledWith("/(auth)/preview-access");
    expect(await previewToken.get()).toBeNull();
  });

  it("passes other 401s through (session expiry stays with the auth flow)", async () => {
    const inner = jest.fn().mockResolvedValue(json(401, { error: { code: "SESSION_EXPIRED", message: "x" } }));
    expect((await withPreviewGate(inner)("http://api/v1/me")).status).toBe(401);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe("PreviewAccessScreen", () => {
  it("stores the token and continues to the wallet sign-in", async () => {
    mockApi.previewGateLogin.mockResolvedValue({ ok: true, expiresAt: "2026-10-17T00:00:00.000Z", token: "t1" });
    await renderWithClient(<PreviewAccessScreen />);
    await fireEvent.changeText(screen.getByLabelText("Email"), "team@bytesac.com");
    await fireEvent.changeText(screen.getByLabelText("Password"), "pw");
    await fireEvent.press(screen.getByText("Continue"));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/(auth)/sign-in"));
    expect(mockApi.previewGateLogin).toHaveBeenCalledWith({ email: "team@bytesac.com", password: "pw" });
    expect(await previewToken.get()).toBe("t1");
  });

  it("shows the denial", async () => {
    mockApi.previewGateLogin.mockRejectedValue(new ApiError("PREVIEW_GATE_DENIED", 401, "Invalid email or password"));
    await renderWithClient(<PreviewAccessScreen />);
    await fireEvent.changeText(screen.getByLabelText("Email"), "team@bytesac.com");
    await fireEvent.changeText(screen.getByLabelText("Password"), "nope");
    await fireEvent.press(screen.getByText("Continue"));
    expect(await screen.findByText("Invalid email or password")).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
