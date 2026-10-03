import { describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async (orig) => ({
  ...(await orig<typeof import("@google/genai")>()),
  GoogleGenAI: class { models = { generateContent: sdk.generateContent, embedContent: vi.fn() }; },
}));

const { geminiSearchCall } = await vi.importActual<typeof import("@/providers/gemini")>("@/providers/gemini");

const reply = (call?: { name: string; args: unknown }) => ({
  functionCalls: call ? [call] : undefined,
  candidates: [{ content: { role: "model", parts: [{ text: "ignored prose" }] } }],
});
const call = (args: unknown) => ({ name: "search_baskets", args });

describe("geminiSearchCall", () => {
  it("forces the single search_baskets function with a 10 s abort signal, and ignores a text-only reply", async () => {
    sdk.generateContent.mockReset().mockResolvedValue(reply());
    const runTool = vi.fn();
    expect(await geminiSearchCall("anything", runTool)).toBeNull();
    expect(runTool).not.toHaveBeenCalled();
    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
    const config = sdk.generateContent.mock.calls[0]![0].config;
    expect(config.toolConfig.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: ["search_baskets"] });
    expect(config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(config.abortSignal.aborted).toBe(false);
  });

  it("stops after one round when the tool found results, returning that round's filters", async () => {
    sdk.generateContent.mockReset().mockResolvedValue(reply(call({ q: "btc" })));
    const runTool = vi.fn().mockResolvedValue({ count: 2 });
    expect(await geminiSearchCall("btc", runTool)).toMatchObject({ q: "btc" });
    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
  });

  it("a second round after an error result; never a third; the last parsed filters win", async () => {
    sdk.generateContent.mockReset()
      .mockResolvedValueOnce(reply(call({ sort: "not-a-sort" })))
      .mockResolvedValue(reply(call({ q: "eth" })));
    const runTool = vi.fn().mockResolvedValue({ error: "bad filters" });
    expect(await geminiSearchCall("eth", runTool)).toMatchObject({ q: "eth" });
    expect(sdk.generateContent).toHaveBeenCalledTimes(2);
    expect(runTool).toHaveBeenCalledTimes(2);
  });

  it("returns null when every call's arguments are invalid, and propagates provider failure", async () => {
    sdk.generateContent.mockReset().mockResolvedValue(reply(call({ sort: "nope" })));
    expect(await geminiSearchCall("x", vi.fn().mockResolvedValue({ count: 0 }))).toBeNull();
    sdk.generateContent.mockReset().mockRejectedValue(new Error("timed out"));
    await expect(geminiSearchCall("x", vi.fn())).rejects.toThrow("timed out");
  });
});
