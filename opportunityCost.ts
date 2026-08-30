export interface OpportunityCandidate {
  symbol: string;
  compositeScore: number | null; // from lib/advisor/recommendationEngine.computeCompositeScore
  volatility: number | null; // annualized
  valuationScore: number | null;
}

export interface OpportunityCostResult {
  status: "COMPARABLE" | "INSUFFICIENT_DATA";
  favors: "A" | "B" | "NEITHER" | null;
  explanation: string;
}

// Minimum score gap before this engine will suggest reallocating — avoids
// churn recommendations over noise-level differences.
const MEANINGFUL_GAP = 12;

/**
 * Never recommends a new asset without weighing it against something the
 * user already holds. Risk-adjusted here means score per unit of
 * volatility, not raw score — a higher score at much higher volatility
 * isn't automatically "better".
 */
export function compareOpportunityCost(a: OpportunityCandidate, b: OpportunityCandidate): OpportunityCostResult {
  if (a.compositeScore === null || b.compositeScore === null) {
    return { status: "INSUFFICIENT_DATA", favors: null, explanation: "Composite scores are not both available — cannot make a reliable comparison." };
  }

  const riskAdjustedA = a.volatility && a.volatility > 0 ? a.compositeScore / (a.volatility * 100) : a.compositeScore;
  const riskAdjustedB = b.volatility && b.volatility > 0 ? b.compositeScore / (b.volatility * 100) : b.compositeScore;

  const gap = riskAdjustedB - riskAdjustedA;

  if (Math.abs(gap) < MEANINGFUL_GAP * 0.05) {
    return { status: "COMPARABLE", favors: "NEITHER", explanation: `${a.symbol} and ${b.symbol} offer a similar risk-adjusted opportunity right now — no reallocation is clearly justified.` };
  }

  if (gap > 0) {
    return {
      status: "COMPARABLE",
      favors: "B",
      explanation: `${b.symbol} currently offers a stronger risk-adjusted opportunity than ${a.symbol} (composite ${b.compositeScore.toFixed(0)} vs ${a.compositeScore.toFixed(0)}${b.volatility && a.volatility ? `, volatility ${(b.volatility * 100).toFixed(0)}% vs ${(a.volatility * 100).toFixed(0)}%` : ""}). Reallocating part of ${a.symbol} into ${b.symbol} may improve portfolio efficiency — this is not a directive to sell ${a.symbol} outright.`,
    };
  }
  return {
    status: "COMPARABLE",
    favors: "A",
    explanation: `${a.symbol} currently offers a stronger risk-adjusted opportunity than ${b.symbol}.`,
  };
}
