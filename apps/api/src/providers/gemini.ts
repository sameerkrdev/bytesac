import { FunctionCallingConfigMode, GoogleGenAI, type Content } from "@google/genai";
import { discoveryFiltersSchema, z, type DiscoveryFilters } from "@repo/validator";
import { env } from "../env";

// An empty key still constructs (callers check GEMINI_API_KEY first); the placeholder only keeps the SDK from warning at startup.
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY || "unset" });

const toolFilters = discoveryFiltersSchema.omit({ cursor: true });
const { $schema: _schema, ...toolSchema } = z.toJSONSchema(toolFilters, { io: "input" });
const EMBEDDING_DIMENSIONS = 768;
const embedding = z.array(z.number()).length(EMBEDDING_DIMENSIONS);

export async function embedText(text: string): Promise<number[]> {
  const res = await ai.models.embedContent({ model: env.GEMINI_EMBEDDING_MODEL, contents: text, config: { outputDimensionality: EMBEDDING_DIMENSIONS } });
  return embedding.parse(res.embeddings?.[0]?.values);
}

/**
 * Translates `query` into filters with one forced function call (`search_baskets`), running each call through `runTool` (validated structured search).
 * A second round happens only when the first tool result was an error or empty, so Gemini can refine; it never sees more than the tool's own summary.
 * Every text part is ignored. Returns the last call whose arguments parsed, or null. Throws on timeout (10 s per call) or API failure.
 */
export async function geminiSearchCall(query: string, runTool: (args: unknown) => Promise<Record<string, unknown>>): Promise<DiscoveryFilters | null> {
  const contents: Content[] = [{ role: "user", parts: [{ text: query }] }];
  let filters: DiscoveryFilters | null = null;
  for (let round = 0; round < 2; round++) {
    const res = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: "You translate basket search requests into a call to search_baskets. Never answer in prose.",
        tools: [{ functionDeclarations: [{ name: "search_baskets", description: "Search published investment baskets by structured filters.", parametersJsonSchema: toolSchema }] }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["search_baskets"] } },
        abortSignal: AbortSignal.timeout(10_000),
      },
    });
    const call = res.functionCalls?.[0];
    if (!call || call.name !== "search_baskets") break;
    const parsed = toolFilters.safeParse(call.args);
    if (parsed.success) filters = parsed.data;
    const result = await runTool(call.args);
    if (!("error" in result) && result.count) break;
    // Model turn as returned (keeps any thought signature), then our tool result.
    contents.push(res.candidates![0]!.content!, { role: "user", parts: [{ functionResponse: { name: "search_baskets", response: result } }] });
  }
  return filters;
}
