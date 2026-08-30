import { PositionExposure, RiskLimits, computeConcentrationWarnings, ConcentrationWarning } from "./riskEngine";

export interface ProposedPurchase {
  symbol: string;
  amount: number; // in base currency
  sector: string | null;
  country: string | null;
  tradingCurrency: string;
  assetClass: string;
  volatility: number | null; // annualized, from computeVolatility — null if unavailable
}

export interface SimulationResult {
  currentConcentration: ConcentrationWarning[];
  proposedConcentration: ConcentrationWarning[];
  currentVolatilityPct: number | null;
  proposedVolatilityPct: number | null;
  concentrationDelta: "IMPROVED" | "WORSENED" | "UNCHANGED";
  explanation: string;
}

/**
 * Portfolio-level volatility here is a simplified capital-weighted average
 * of position volatilities — a true portfolio variance would need the full
 * pairwise correlation matrix (see lib/portfolio/riskMetrics.computeCorrelation
 * for the primitive). This proxy is stated explicitly rather than presented
 * as more precise than it is.
 */
function weightedVolatility(
  positions: (PositionExposure & { volatility: number | null })[]
): number | null {
  const withVol = positions.filter((p) => p.volatility !== null);
  if (withVol.length === 0) return null;
  const total = withVol.reduce((s, p) => s + p.valueInBaseCurrency, 0);
  if (total === 0) return null;
  return withVol.reduce((s, p) => s + (p.volatility as number) * (p.valueInBaseCurrency / total), 0);
}

/**
 * "Before buying" simulation — never recommends a new position without
 * showing its effect on the whole portfolio first.
 */
export function simulatePurchase(
  currentPositions: (PositionExposure & { volatility: number | null })[],
  cashBalance: number,
  limits: RiskLimits,
  proposed: ProposedPurchase
): SimulationResult {
  const currentConcentration = computeConcentrationWarnings(currentPositions, limits, cashBalance);
  const currentVolatilityPct = weightedVolatility(currentPositions);

  const proposedPositions = [
    ...currentPositions,
    {
      symbol: proposed.symbol,
      valueInBaseCurrency: proposed.amount,
      sector: proposed.sector,
      country: proposed.country,
      tradingCurrency: proposed.tradingCurrency,
      assetClass: proposed.assetClass,
      liquidityRisk: null,
      volatility: proposed.volatility,
    },
  ];
  const proposedCashBalance = cashBalance - proposed.amount;
  const proposedConcentration = computeConcentrationWarnings(proposedPositions, limits, proposedCashBalance);
  const proposedVolatilityPct = weightedVolatility(proposedPositions);

  const currentWarningWeight = currentConcentration.reduce((s, w) => s + w.excessPct, 0);
  const proposedWarningWeight = proposedConcentration.reduce((s, w) => s + w.excessPct, 0);

  let concentrationDelta: SimulationResult["concentrationDelta"] = "UNCHANGED";
  if (proposedWarningWeight > currentWarningWeight + 0.5) concentrationDelta = "WORSENED";
  else if (proposedWarningWeight < currentWarningWeight - 0.5) concentrationDelta = "IMPROVED";

  let explanation: string;
  if (concentrationDelta === "WORSENED") {
    const newBreaches = proposedConcentration.filter(
      (w) => !currentConcentration.some((c) => c.type === w.type && c.label === w.label)
    );
    explanation = newBreaches.length
      ? `This purchase would push ${newBreaches.map((w) => w.label).join(", ")} over your configured limit(s). ${newBreaches[0].why}`
      : "This purchase increases existing concentration risk beyond your configured limits.";
  } else if (concentrationDelta === "IMPROVED") {
    explanation = "This purchase improves diversification and reduces concentration risk relative to your current portfolio.";
  } else {
    explanation = "This purchase has a neutral effect on portfolio concentration.";
  }

  if (currentVolatilityPct !== null && proposedVolatilityPct !== null) {
    const volDeltaPct = (proposedVolatilityPct - currentVolatilityPct) * 100;
    if (Math.abs(volDeltaPct) >= 0.5) {
      explanation += ` Estimated portfolio volatility moves from ${(currentVolatilityPct * 100).toFixed(1)}% to ${(proposedVolatilityPct * 100).toFixed(1)}% annualized (capital-weighted approximation, not a full covariance model).`;
    }
  }

  return { currentConcentration, proposedConcentration, currentVolatilityPct, proposedVolatilityPct, concentrationDelta, explanation };
}
