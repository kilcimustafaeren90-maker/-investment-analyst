import { z } from "zod";

// This is the ONLY shape the AI layer is allowed to return. Anything that
// doesn't validate is discarded — the caller falls back to showing
// "AI analysis unavailable", never a guessed value.

export const CaseScenarioSchema = z.object({
  priceRangeLow: z.number(),
  priceRangeHigh: z.number(),
  probability: z.number().min(0).max(1),
  narrative: z.string(),
});

export const AIAnalysisSchema = z.object({
  recommendation: z.enum(["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  timeHorizons: z.object({
    shortTerm: z.enum(["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"]),
    mediumTerm: z.enum(["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"]),
    longTerm: z.enum(["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"]),
  }),
  bullCase: CaseScenarioSchema,
  baseCase: CaseScenarioSchema,
  bearCase: CaseScenarioSchema,
  catalysts: z.array(z.string()).max(10),
  risks: z.array(z.string()).max(10),
  reasons: z.array(z.string()).max(10),
}).refine(
  (data) => {
    const sum = data.bullCase.probability + data.baseCase.probability + data.bearCase.probability;
    return Math.abs(sum - 1) < 0.05;
  },
  { message: "Bull/base/bear probabilities must sum to ~1.0" }
);

export type AIAnalysis = z.infer<typeof AIAnalysisSchema>;

/**
 * The AI layer must NEVER receive raw external API responses. It only ever
 * sees this normalized, already-computed shape — RSI/MACD/valuation/etc.
 * are calculated deterministically before the model ever sees the data.
 */
export const AIInputSchema = z.object({
  symbol: z.string(),
  currentPrice: z.number(),
  currency: z.string(),
  technicalIndicators: z.record(z.string(), z.number().nullable()),
  fundamentals: z.record(z.string(), z.number().nullable()),
  valuation: z.record(z.string(), z.number().nullable()),
  companyScore: z.number().nullable(),
  news: z.array(
    z.object({ headline: z.string(), sentiment: z.string().optional(), publishedAt: z.string() })
  ),
  macroContext: z.record(z.string(), z.number().nullable()),
  sector: z.string().nullable(),
  upcomingEarnings: z.string().nullable(),
});

export type AIInput = z.infer<typeof AIInputSchema>;
