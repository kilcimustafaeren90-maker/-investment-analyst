import { BalanceSheetSnapshot, OverviewMetrics } from "../providers/types";

export type SectorFramework = "BANK" | "INDUSTRIAL" | "TECHNOLOGY" | "HOLDING" | "DEFAULT";

export function classifySectorFramework(sector: string | null, industry: string | null): SectorFramework {
  const s = `${sector ?? ""} ${industry ?? ""}`.toLowerCase();
  if (/bank|insurance|financial/.test(s)) return "BANK";
  if (/technology|software|semiconductor|internet/.test(s)) return "TECHNOLOGY";
  if (/holding|conglomerate|investment company/.test(s)) return "HOLDING";
  if (/industrial|manufactur|energy|materials|utilit/.test(s)) return "INDUSTRIAL";
  return "DEFAULT";
}

// Per-sector weighting of what matters for the valuation score. This is
// what stands in for "do not apply a universal P/B<1=BUY rule" — the same
// P/B ratio contributes very differently to a bank's score than to a
// software company's.
const SECTOR_WEIGHTS: Record<
  SectorFramework,
  { pb: number; pe: number; evEbitda: number; fcfYield: number; roe: number }
> = {
  BANK: { pb: 0.35, pe: 0.15, evEbitda: 0.0, fcfYield: 0.0, roe: 0.5 },
  INDUSTRIAL: { pb: 0.15, pe: 0.2, evEbitda: 0.3, fcfYield: 0.2, roe: 0.15 },
  TECHNOLOGY: { pb: 0.05, pe: 0.2, evEbitda: 0.2, fcfYield: 0.35, roe: 0.2 },
  HOLDING: { pb: 0.4, pe: 0.1, evEbitda: 0.1, fcfYield: 0.1, roe: 0.3 },
  DEFAULT: { pb: 0.2, pe: 0.2, evEbitda: 0.2, fcfYield: 0.2, roe: 0.2 },
};

export interface BookValueResult {
  status: "OK" | "DATA_UNAVAILABLE";
  bookValue: number | null;
  tangibleBookValue: number | null;
  bookValuePerShare: number | null;
  tangibleBookValuePerShare: number | null;
}

export function computeBookValue(
  balanceSheet: BalanceSheetSnapshot | null,
  sharesOutstanding: number | null
): BookValueResult {
  if (!balanceSheet || balanceSheet.shareholdersEquity === null) {
    return { status: "DATA_UNAVAILABLE", bookValue: null, tangibleBookValue: null, bookValuePerShare: null, tangibleBookValuePerShare: null };
  }
  const bookValue = balanceSheet.shareholdersEquity;
  const goodwill = balanceSheet.goodwill ?? 0;
  const intangibles = balanceSheet.intangibleAssets ?? 0;
  const tangibleBookValue = bookValue - goodwill - intangibles;

  return {
    status: "OK",
    bookValue,
    tangibleBookValue,
    bookValuePerShare: sharesOutstanding ? bookValue / sharesOutstanding : null,
    tangibleBookValuePerShare: sharesOutstanding ? tangibleBookValue / sharesOutstanding : null,
  };
}

export interface MarketValueResult {
  status: "OK" | "DATA_UNAVAILABLE";
  marketCap: number | null;
  enterpriseValue: number | null;
}

export function computeMarketValue(
  price: number | null,
  sharesOutstanding: number | null,
  totalDebt: number | null,
  cash: number | null
): MarketValueResult {
  if (price === null || sharesOutstanding === null) {
    return { status: "DATA_UNAVAILABLE", marketCap: null, enterpriseValue: null };
  }
  const marketCap = price * sharesOutstanding;
  const enterpriseValue =
    totalDebt !== null && cash !== null ? marketCap + totalDebt - cash : null;
  return { status: "OK", marketCap, enterpriseValue };
}

export interface AssetQualityResult {
  status: "OK" | "DATA_UNAVAILABLE";
  tangibleAssetRatio: number | null; // (totalAssets - goodwill - intangibles) / totalAssets
  goodwillToEquity: number | null;
  intangiblesToEquity: number | null;
  riskFlag: "LOW" | "MEDIUM" | "HIGH" | null;
}

export function assessAssetQuality(bs: BalanceSheetSnapshot | null): AssetQualityResult {
  if (!bs || bs.totalAssets === null || bs.shareholdersEquity === null) {
    return { status: "DATA_UNAVAILABLE", tangibleAssetRatio: null, goodwillToEquity: null, intangiblesToEquity: null, riskFlag: null };
  }
  const goodwill = bs.goodwill ?? 0;
  const intangibles = bs.intangibleAssets ?? 0;
  const tangibleAssetRatio = (bs.totalAssets - goodwill - intangibles) / bs.totalAssets;
  const goodwillToEquity = bs.shareholdersEquity !== 0 ? goodwill / bs.shareholdersEquity : null;
  const intangiblesToEquity = bs.shareholdersEquity !== 0 ? intangibles / bs.shareholdersEquity : null;

  let riskFlag: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  if (bs.shareholdersEquity < 0) riskFlag = "HIGH";
  else if ((goodwillToEquity ?? 0) + (intangiblesToEquity ?? 0) > 0.75) riskFlag = "HIGH";
  else if ((goodwillToEquity ?? 0) + (intangiblesToEquity ?? 0) > 0.4) riskFlag = "MEDIUM";

  return { status: "OK", tangibleAssetRatio, goodwillToEquity, intangiblesToEquity, riskFlag };
}

export type ValuationClass = "VERY_CHEAP" | "CHEAP" | "FAIR" | "EXPENSIVE" | "VERY_EXPENSIVE" | "UNKNOWN";

/**
 * Sector-aware classification. Deliberately does NOT apply a single
 * universal P/B threshold — a P/B of 0.9 means something very different
 * for a bank than for a software company, so the framework and comparison
 * baseline both shift by sector.
 */
export function classifyValuation(
  framework: SectorFramework,
  pb: number | null,
  sectorMedianPB: number | null
): ValuationClass {
  if (pb === null) return "UNKNOWN";
  const baseline = sectorMedianPB ?? { BANK: 1.1, INDUSTRIAL: 1.8, TECHNOLOGY: 6, HOLDING: 1.0, DEFAULT: 2.5 }[framework];
  const ratio = pb / baseline;
  if (ratio < 0.5) return "VERY_CHEAP";
  if (ratio < 0.8) return "CHEAP";
  if (ratio <= 1.2) return "FAIR";
  if (ratio <= 1.8) return "EXPENSIVE";
  return "VERY_EXPENSIVE";
}

export interface ValueTrapResult {
  status: "OK" | "DATA_UNAVAILABLE";
  riskScore: number | null; // 0-100, higher = more likely a value trap
  label: "LOW" | "MEDIUM" | "HIGH" | null;
}

/**
 * Low P/B + high ROE => possible undervaluation.
 * Low P/B + low/negative ROE => possible value trap.
 * This never converts into an automatic BUY/SELL by itself — it's one
 * input the AI explanation layer reasons about, alongside asset quality,
 * debt, and sector context.
 */
export function computeValueTrapRisk(pb: number | null, roe: number | null): ValueTrapResult {
  if (pb === null || roe === null) return { status: "DATA_UNAVAILABLE", riskScore: null, label: null };
  if (pb >= 1) return { status: "OK", riskScore: 10, label: "LOW" }; // not even cheap on P/B — trap framing doesn't apply
  // pb < 1 (statistically "cheap" on book): risk rises as ROE falls.
  const roePct = roe * 100;
  let riskScore: number;
  if (roePct >= 12) riskScore = 15;
  else if (roePct >= 6) riskScore = 40;
  else if (roePct >= 0) riskScore = 70;
  else riskScore = 90;
  const label = riskScore >= 70 ? "HIGH" : riskScore >= 40 ? "MEDIUM" : "LOW";
  return { status: "OK", riskScore, label };
}

export interface NAVResult {
  status: "OK" | "DATA_UNAVAILABLE";
  nav: number | null;
  navDiscountPct: number | null; // (marketCap - NAV) / NAV; negative = discount
}

/**
 * Only meaningful for asset-heavy business models (holdings, real estate,
 * investment companies, banks) — the spec explicitly scopes this. For
 * other sectors, callers should not surface this panel at all.
 */
export function computeNAV(
  totalAssets: number | null,
  totalLiabilities: number | null,
  marketCap: number | null
): NAVResult {
  if (totalAssets === null || totalLiabilities === null) {
    return { status: "DATA_UNAVAILABLE", nav: null, navDiscountPct: null };
  }
  const nav = totalAssets - totalLiabilities;
  const navDiscountPct = marketCap !== null && nav !== 0 ? ((marketCap - nav) / nav) * 100 : null;
  return { status: "OK", nav, navDiscountPct };
}

export interface ValuationScoreResult {
  status: "SCORED" | "INSUFFICIENT_DATA";
  score: number | null;
  framework: SectorFramework;
}

/**
 * 0-100 composite, weighted per sector framework. Missing inputs are
 * dropped and remaining weights renormalized — never backfilled with a
 * guess, and never scored at all below 50% weight coverage.
 */
export function computeValuationScore(
  framework: SectorFramework,
  metrics: OverviewMetrics | null
): ValuationScoreResult {
  if (!metrics) return { status: "INSUFFICIENT_DATA", score: null, framework };
  const weights = SECTOR_WEIGHTS[framework];

  // Each sub-score maps a raw ratio to a 0-100 "cheapness/quality" score.
  // Lower P/B, P/E, EV/EBITDA => higher sub-score (cheaper); higher FCF
  // yield and ROE => higher sub-score (better quality).
  const subScores: { key: keyof typeof weights; value: number | null }[] = [
    { key: "pb", value: metrics.pbRatio !== null ? clampScore(100 - metrics.pbRatio * 15) : null },
    { key: "pe", value: metrics.peRatio !== null && metrics.peRatio > 0 ? clampScore(100 - metrics.peRatio * 3) : null },
    { key: "evEbitda", value: metrics.evToEbitda !== null ? clampScore(100 - metrics.evToEbitda * 4) : null },
    { key: "fcfYield", value: null }, // requires cash-flow statement, not wired in V1 balance-sheet pass
    { key: "roe", value: metrics.roe !== null ? clampScore(metrics.roe * 400) : null },
  ];

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const coveredWeight = subScores
    .filter((s) => s.value !== null)
    .reduce((sum, s) => sum + weights[s.key], 0);

  if (coveredWeight / totalWeight < 0.5) {
    return { status: "INSUFFICIENT_DATA", score: null, framework };
  }

  const score = subScores.reduce((sum, s) => {
    if (s.value === null) return sum;
    return sum + (s.value * weights[s.key]) / coveredWeight;
  }, 0);

  return { status: "SCORED", score: Math.round(score * 10) / 10, framework };
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, v));
}
