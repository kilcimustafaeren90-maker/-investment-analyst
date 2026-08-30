import crypto from "crypto";
import { AIInput, AIInputSchema, AIAnalysis, AIAnalysisSchema } from "./schema";

const SYSTEM_PROMPT = `You are a financial research analyst producing STRUCTURED JSON ONLY.
You are given already-computed technical indicators, fundamentals, valuation
metrics, and a company score. Do NOT invent numbers that were not provided
to you. Do NOT recompute RSI/MACD/valuation yourself — use what is given.
Your job is synthesis, explanation, and scenario framing only.
Respond with ONLY a JSON object matching this shape, no prose, no markdown
fences:
{
  "recommendation": "STRONG_BUY|BUY|HOLD|SELL|STRONG_SELL",
  "confidence": "LOW|MEDIUM|HIGH",
  "risk": "LOW|MEDIUM|HIGH",
  "timeHorizons": {"shortTerm": "...", "mediumTerm": "...", "longTerm": "..."},
  "bullCase": {"priceRangeLow": number, "priceRangeHigh": number, "probability": number, "narrative": string},
  "baseCase": {"priceRangeLow": number, "priceRangeHigh": number, "probability": number, "narrative": string},
  "bearCase": {"priceRangeLow": number, "priceRangeHigh": number, "probability": number, "narrative": string},
  "catalysts": [string],
  "risks": [string],
  "reasons": [string]
}
Probabilities for bull/base/bear must sum to ~1.0. These are model
estimates, not guarantees — reflect that in the narrative language.`;

export function hashAIInput(input: AIInput): string {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export async function generateAIAnalysis(
  rawInput: unknown
): Promise<{ status: "OK" | "INVALID_INPUT" | "NOT_CONFIGURED" | "INVALID_OUTPUT" | "ERROR"; analysis: AIAnalysis | null }> {
  const parsedInput = AIInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    return { status: "INVALID_INPUT", analysis: null };
  }

  if (!process.env.AI_API_KEY) {
    return { status: "NOT_CONFIGURED", analysis: null };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.AI_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(parsedInput.data) }],
      }),
    });

    if (!res.ok) return { status: "ERROR", analysis: null };
    const json = await res.json();
    const text = (json.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");

    let candidate: unknown;
    try {
      candidate = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      return { status: "INVALID_OUTPUT", analysis: null };
    }

    const validated = AIAnalysisSchema.safeParse(candidate);
    if (!validated.success) {
      return { status: "INVALID_OUTPUT", analysis: null };
    }
    return { status: "OK", analysis: validated.data };
  } catch {
    return { status: "ERROR", analysis: null };
  }
}
