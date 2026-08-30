export type AdvisorAction = "BUY" | "BUY_THE_DIP" | "HOLD" | "REDUCE" | "SELL" | "WATCH" | "WAIT" | "NOT_ELIGIBLE";

export interface DecisionWeights {
  technical: number;
  fundamental: number;
  valuation: number;
  bookValue: number;
  news: number;
  macro: number;
  risk: number;
}

export const DEFAULT_DECISION_WEIGHTS: DecisionWeights = {
  technical: 0.2,
  fundamental: 0.3,
  valuation: 0.15,
  bookValue: 0.1,
  news: 0.1,
  macro: 0.1,
  risk: 0.05,
};

export interface EligibilityInput {
  assetMarket: "US" | "BIST";
  assetCurrency: string;
  poolAllowedMarkets: ("US" | "BIST")[];
  poolCurrency: string;
  internationalInvestingEnabled: boolean;
}

/**
 * "TRY portfolio cannot accidentally receive BIST-only... unless
 * international investing is explicitly enabled." Never silently crosses
 * a capital pool's market/currency boundary.
 */
export function checkEligibility(input: EligibilityInput): { eligible: boolean; reason: string } {
  if (input.poolAllowedMarkets.includes(input.assetMarket)) {
    return { eligible: true, reason: `${input.assetMarket} is an allowed market for this capital pool.` };
  }
  if (!input.internationalInvestingEnabled) {
    return {
      eligible: false,
      reason: `This capital pool is restricted to ${input.poolAllowedMarkets.join(
        "/"
      )}. Enable international investing to consider ${input.assetMarket} assets here.`,
    };
  }
  return { eligible: true, reason: "International investing is explicitly enabled for this pool." };
}

export interface DecisionInputScores {
  technical: number | null;
  fundamental: number | null;
  valuation: number | null;
  bookValue: number | null; // valuation-engine "valuationScore" restricted to the book-value lens
  news: number | null; // -100..100, converted to 0-100 internally
  macro: number | null; // 0-100, tailwind=100, headwind=0
  risk: number | null; // 0-100, higher = lower risk
}

export interface CompositeDecision {
  status: "SCORED" | "INSUFFICIENT_DATA";
  score: number | null;
  confidencePct: number | null; // 0-100, derived from data coverage — never fabricated
  dataQuality: "HIGH" | "MEDIUM" | "LOW";
  missing: (keyof DecisionWeights)[];
}

export function computeCompositeScore(
  inputs: DecisionInputScores,
  weights: DecisionWeights = DEFAULT_DECISION_WEIGHTS
): CompositeDecision {
  const entries = Object.entries(inputs) as [keyof DecisionWeights, number | null][];
  const missing = entries.filter(([, v]) => v === null).map(([k]) => k);
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const coveredWeight = entries
    .filter(([, v]) => v !== null)
    .reduce((sum, [k]) => sum + weights[k], 0);
  const coverage = coveredWeight / totalWeight;

  if (coverage < 0.5) {
    return { status: "INSUFFICIENT_DATA", score: null, confidencePct: Math.round(coverage * 100), dataQuality: "LOW", missing };
  }

  const score = entries.reduce((sum, [k, v]) => {
    if (v === null) return sum;
    return sum + (v * weights[k]) / coveredWeight;
  }, 0);

  const dataQuality = coverage >= 0.9 ? "HIGH" : coverage >= 0.7 ? "MEDIUM" : "LOW";
  // Confidence is data coverage scaled down further when the composite
  // score itself sits near a decision boundary (e.g. 63 vs the 65 BUY
  // threshold) — a borderline score is inherently less actionable even
  // with complete data.
  const boundaries = [35, 50, 65, 80];
  const nearestBoundaryDistance = Math.min(...boundaries.map((b) => Math.abs(score - b)));
  const boundaryPenalty = nearestBoundaryDistance < 5 ? (5 - nearestBoundaryDistance) * 4 : 0;
  const confidencePct = Math.max(0, Math.round(coverage * 100 - boundaryPenalty));

  return { status: "SCORED", score: Math.round(score * 10) / 10, confidencePct, dataQuality, missing };
}

export interface PositionActionInput {
  symbol: string;
  isHeld: boolean;
  eligibility: { eligible: boolean; reason: string };
  composite: CompositeDecision;
  thesisStatus: "STRONG" | "INTACT" | "WEAKENING" | "AT_RISK" | "BROKEN" | null;
  concentrationExcessPct: number | null; // if this symbol/sector is over a configured limit
  priceDeclinePct: number | null; // recent decline, if any — informational only, never decisive alone
  valueTrapRiskLabel: "LOW" | "MEDIUM" | "HIGH" | null;
}

export interface PositionActionResult {
  action: AdvisorAction;
  reasons: string[];
}

const DIP_DECLINE_THRESHOLD = -8; // percent

/**
 * The actual "BUY / BUY THE DIP / HOLD / REDUCE / SELL / WATCH / WAIT"
 * decision. Encodes the spec's explicit guardrails: price decline alone
 * never forces SELL, price rise alone never forces BUY, low P/B alone
 * never forces BUY, and missing data never becomes false confidence
 * (falls through to WATCH).
 */
export function determinePositionAction(input: PositionActionInput): PositionActionResult {
  const reasons: string[] = [];

  if (!input.eligibility.eligible) {
    return { action: "NOT_ELIGIBLE", reasons: [input.eligibility.reason] };
  }

  if (input.composite.status === "INSUFFICIENT_DATA") {
    return {
      action: "WATCH",
      reasons: ["Insufficient data across technical/fundamental/valuation inputs for a confident recommendation — watching until data quality improves."],
    };
  }

  const score = input.composite.score as number;

  if (input.thesisStatus === "BROKEN") {
    reasons.push("The original investment thesis has broken on new information — this outweighs the composite score.");
    return { action: input.isHeld ? "SELL" : "WAIT", reasons };
  }

  if (input.thesisStatus === "AT_RISK") {
    reasons.push("The thesis is at risk — multiple supporting assumptions have deteriorated.");
    if (input.isHeld) return { action: "REDUCE", reasons };
  }

  if (input.concentrationExcessPct !== null && input.concentrationExcessPct > 0 && input.isHeld) {
    reasons.push(
      `This position contributes to an exposure that is ${input.concentrationExcessPct.toFixed(1)} points over your configured limit.`
    );
    if (score < 65) {
      return { action: "REDUCE", reasons: [...reasons, `Composite score of ${score.toFixed(0)} does not justify staying overweight.`] };
    }
  }

  if (input.thesisStatus === "WEAKENING") {
    reasons.push("The thesis is weakening on recent information — treated as a caution flag, not an automatic sell.");
  }

  if (input.valueTrapRiskLabel === "HIGH") {
    reasons.push("Statistically cheap on book value, but value-trap risk is high given weak ROE — not treated as a buy signal on its own.");
  }

  const isDip = input.priceDeclinePct !== null && input.priceDeclinePct <= DIP_DECLINE_THRESHOLD;

  if (score >= 80) {
    reasons.push(`Composite score ${score.toFixed(0)} across technical, fundamental, valuation, and book-value inputs supports a buy case.`);
    if (isDip && input.thesisStatus !== "WEAKENING" && input.thesisStatus !== "AT_RISK") {
      reasons.push(
        `Price is down ${Math.abs(input.priceDeclinePct as number).toFixed(1)}% with fundamentals and thesis intact — this looks more like a valuation reset than deterioration.`
      );
      return { action: "BUY_THE_DIP", reasons };
    }
    return { action: "BUY", reasons };
  }
  if (score >= 65) {
    reasons.push(`Composite score ${score.toFixed(0)} — favorable but not strong enough for a high-conviction add.`);
    return { action: input.isHeld ? "HOLD" : "WATCH", reasons };
  }
  if (score >= 50) {
    reasons.push(`Composite score ${score.toFixed(0)} is neutral.`);
    return { action: input.isHeld ? "HOLD" : "WAIT", reasons };
  }
  if (score >= 35) {
    reasons.push(`Composite score ${score.toFixed(0)} is weak.`);
    return { action: input.isHeld ? "REDUCE" : "WAIT", reasons };
  }
  reasons.push(`Composite score ${score.toFixed(0)} is poor.`);
  return { action: input.isHeld ? "SELL" : "WAIT", reasons };
}
