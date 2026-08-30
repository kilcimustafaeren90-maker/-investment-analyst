export interface PositionExposure {
  symbol: string;
  valueInBaseCurrency: number;
  sector: string | null;
  country: string | null;
  tradingCurrency: string;
  assetClass: string; // STOCK | ETF | BOND | GOLD | CASH | ...
  liquidityRisk: "LOW" | "MEDIUM" | "HIGH" | null; // from computeLiquidityRisk — null if volume data unavailable
}

export interface RiskLimits {
  maxSinglePositionPct: number;
  maxSectorPct: number;
  maxCountryPct: number;
  maxCurrencyPct: number;
  maxAssetClassPct: number;
  minCashPct: number;
  maxIlliquidPct: number;
}

export type ConcentrationType = "POSITION" | "SECTOR" | "COUNTRY" | "CURRENCY" | "ASSET_CLASS" | "CASH" | "ILLIQUID";

export interface ConcentrationWarning {
  type: ConcentrationType;
  label: string;
  currentPct: number;
  limitPct: number;
  excessPct: number;
  status: "HIGH_RISK" | "ELEVATED";
  why: string; // the "because NVDA, AAPL and MSFT collectively represent 51%..." explanation
  recommendation: string;
}

function groupExposure(positions: PositionExposure[], key: keyof PositionExposure) {
  const total = positions.reduce((s, p) => s + p.valueInBaseCurrency, 0);
  if (total === 0) return [];
  const map = new Map<string, PositionExposure[]>();
  positions.forEach((p) => {
    const k = (p[key] as string) ?? "Unknown";
    map.set(k, [...(map.get(k) ?? []), p]);
  });
  return Array.from(map.entries()).map(([label, members]) => ({
    label,
    pct: (members.reduce((s, m) => s + m.valueInBaseCurrency, 0) / total) * 100,
    members,
  }));
}

function explainGroup(label: string, dimension: string, members: PositionExposure[], total: number, pct: number): string {
  const sorted = [...members].sort((a, b) => b.valueInBaseCurrency - a.valueInBaseCurrency);
  const top = sorted.slice(0, 3);
  const topPct = (top.reduce((s, m) => s + m.valueInBaseCurrency, 0) / total) * 100;
  const names = top.map((m) => m.symbol).join(", ");
  return `Your portfolio has ${pct.toFixed(0)}% exposure to ${label} because ${names} collectively represent ${topPct.toFixed(0)}% of total capital.`;
}

/**
 * Deterministic concentration check across every dimension the spec asks
 * for — the same "technology exposure is 43%, above your configured 30%
 * maximum" behavior, but every warning also carries a factual WHY built
 * from the actual constituent positions, not a generic risk label.
 */
export function computeConcentrationWarnings(
  positions: PositionExposure[],
  limits: RiskLimits,
  cashBalance: number
): ConcentrationWarning[] {
  const warnings: ConcentrationWarning[] = [];
  const invested = positions.reduce((s, p) => s + p.valueInBaseCurrency, 0);
  const total = invested + cashBalance;
  if (total === 0) return [];

  positions.forEach((p) => {
    const pct = (p.valueInBaseCurrency / invested) * 100;
    if (pct > limits.maxSinglePositionPct) {
      const excessPct = pct - limits.maxSinglePositionPct;
      warnings.push({
        type: "POSITION",
        label: p.symbol,
        currentPct: Math.round(pct * 10) / 10,
        limitPct: limits.maxSinglePositionPct,
        excessPct: Math.round(excessPct * 10) / 10,
        status: excessPct > 10 ? "HIGH_RISK" : "ELEVATED",
        why: `${p.symbol} alone represents ${pct.toFixed(0)}% of invested capital, above your ${limits.maxSinglePositionPct}% single-position limit.`,
        recommendation: `Consider trimming ${p.symbol} toward your configured limit.`,
      });
    }
  });

  const dims: { key: keyof PositionExposure; type: ConcentrationType; limit: number }[] = [
    { key: "sector", type: "SECTOR", limit: limits.maxSectorPct },
    { key: "country", type: "COUNTRY", limit: limits.maxCountryPct },
    { key: "tradingCurrency", type: "CURRENCY", limit: limits.maxCurrencyPct },
    { key: "assetClass", type: "ASSET_CLASS", limit: limits.maxAssetClassPct },
  ];

  dims.forEach(({ key, type, limit }) => {
    groupExposure(positions, key).forEach((g) => {
      if (g.pct > limit) {
        const excessPct = g.pct - limit;
        warnings.push({
          type,
          label: g.label,
          currentPct: Math.round(g.pct * 10) / 10,
          limitPct: limit,
          excessPct: Math.round(excessPct * 10) / 10,
          status: excessPct > 10 ? "HIGH_RISK" : "ELEVATED",
          why: explainGroup(g.label, g.label, g.members, invested, g.pct),
          recommendation: `Consider reducing ${g.label} exposure.`,
        });
      }
    });
  });

  const illiquidValue = positions.filter((p) => p.liquidityRisk === "HIGH").reduce((s, p) => s + p.valueInBaseCurrency, 0);
  const illiquidPct = invested > 0 ? (illiquidValue / invested) * 100 : 0;
  if (illiquidPct > limits.maxIlliquidPct) {
    const illiquidSymbols = positions.filter((p) => p.liquidityRisk === "HIGH").map((p) => p.symbol);
    const excessPct = illiquidPct - limits.maxIlliquidPct;
    warnings.push({
      type: "ILLIQUID",
      label: "Illiquid positions",
      currentPct: Math.round(illiquidPct * 10) / 10,
      limitPct: limits.maxIlliquidPct,
      excessPct: Math.round(excessPct * 10) / 10,
      status: excessPct > 10 ? "HIGH_RISK" : "ELEVATED",
      why: `${illiquidSymbols.join(", ")} would take an estimated 10+ trading days to exit at typical volume without materially moving the price.`,
      recommendation: "Consider reducing illiquid exposure or sizing new illiquid positions more conservatively.",
    });
  }

  const cashPct = total > 0 ? (cashBalance / total) * 100 : 0;
  if (cashPct < limits.minCashPct) {
    warnings.push({
      type: "CASH",
      label: "Cash",
      currentPct: Math.round(cashPct * 10) / 10,
      limitPct: limits.minCashPct,
      excessPct: Math.round((limits.minCashPct - cashPct) * 10) / 10,
      status: limits.minCashPct - cashPct > 5 ? "HIGH_RISK" : "ELEVATED",
      why: `Cash is ${cashPct.toFixed(1)}% of the portfolio, below your configured ${limits.minCashPct}% minimum liquidity buffer.`,
      recommendation: "Consider raising cash before adding new positions.",
    });
  }

  return warnings.sort((a, b) => b.excessPct - a.excessPct);
}

export interface HealthInputs {
  warnings: ConcentrationWarning[];
  brokenThesisCount: number;
  weakenedThesisCount: number;
  avgValuationScore: number | null; // 0-100, from the valuation engine, averaged across holdings
  avgFundamentalScore: number | null; // 0-100
  maxDrawdownPct: number | null; // negative number, e.g. -18.4
  avgCorrelation: number | null; // -1..1, average pairwise correlation across holdings (lower = better diversified)
}

const HEALTH_WEIGHTS = {
  concentration: 0.25,
  thesis: 0.15,
  liquidity: 0.1,
  valuation: 0.15,
  fundamental: 0.15,
  drawdown: 0.1,
  diversification: 0.1,
};

/**
 * 0-100 portfolio health, combining diversification, risk, liquidity,
 * valuation, fundamental quality, concentration, and drawdown. Missing
 * inputs (e.g. no valuation scores wired yet) are dropped and remaining
 * weights renormalized — never backfilled with a guess.
 */
export function computePortfolioHealth(inputs: HealthInputs): { status: "SCORED" | "PARTIAL"; health: number; missing: string[] } {
  const concentrationPenalty = inputs.warnings
    .filter((w) => w.type !== "CASH")
    .reduce((sum, w) => sum + Math.min(15, w.excessPct), 0);
  const concentrationScore = Math.max(0, 100 - concentrationPenalty * 2);

  const liquidityWarning = inputs.warnings.find((w) => w.type === "ILLIQUID" || w.type === "CASH");
  const liquidityScore = liquidityWarning ? Math.max(0, 100 - liquidityWarning.excessPct * 5) : 100;

  const thesisScore = Math.max(0, 100 - inputs.brokenThesisCount * 35 - inputs.weakenedThesisCount * 15);

  const drawdownScore = inputs.maxDrawdownPct !== null ? Math.max(0, 100 + inputs.maxDrawdownPct * 2) : null;
  const diversificationScore = inputs.avgCorrelation !== null ? Math.max(0, 100 - Math.max(0, inputs.avgCorrelation) * 100) : null;

  const components: { key: keyof typeof HEALTH_WEIGHTS; value: number | null }[] = [
    { key: "concentration", value: concentrationScore },
    { key: "thesis", value: thesisScore },
    { key: "liquidity", value: liquidityScore },
    { key: "valuation", value: inputs.avgValuationScore },
    { key: "fundamental", value: inputs.avgFundamentalScore },
    { key: "drawdown", value: drawdownScore },
    { key: "diversification", value: diversificationScore },
  ];

  const missing = components.filter((c) => c.value === null).map((c) => c.key);
  const totalWeight = Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0);
  const coveredWeight = components.filter((c) => c.value !== null).reduce((s, c) => s + HEALTH_WEIGHTS[c.key], 0);

  const health = components.reduce((sum, c) => {
    if (c.value === null) return sum;
    return sum + (c.value * HEALTH_WEIGHTS[c.key]) / coveredWeight;
  }, 0);

  return {
    status: coveredWeight / totalWeight >= 0.95 ? "SCORED" : "PARTIAL",
    health: Math.max(0, Math.round(health)),
    missing,
  };
}
