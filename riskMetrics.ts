/**
 * All functions here take real historical closes/returns as input. If a
 * caller doesn't have enough history for a given asset, it should pass an
 * empty/short array and treat the null result as DATA UNAVAILABLE — nothing
 * here backfills or estimates missing history.
 */

export function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    out.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return out;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

const MIN_OBSERVATIONS = 20;

/** Annualized volatility (252 trading days) from a closing-price series. */
export function computeVolatility(closes: number[]): number | null {
  const returns = dailyReturns(closes);
  if (returns.length < MIN_OBSERVATIONS) return null;
  return stdDev(returns) * Math.sqrt(252);
}

/** Pearson correlation between two return series over their overlapping window. */
export function computeCorrelation(returnsA: number[], returnsB: number[]): number | null {
  const n = Math.min(returnsA.length, returnsB.length);
  if (n < MIN_OBSERVATIONS) return null;
  const a = returnsA.slice(-n);
  const b = returnsB.slice(-n);
  const meanA = mean(a);
  const meanB = mean(b);
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - meanA) * (b[i] - meanB);
    varA += (a[i] - meanA) ** 2;
    varB += (b[i] - meanB) ** 2;
  }
  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

/** Beta of an asset's returns against a benchmark's returns (e.g. S&P 500 / BIST 100). */
export function computeBeta(assetReturns: number[], benchmarkReturns: number[]): number | null {
  const n = Math.min(assetReturns.length, benchmarkReturns.length);
  if (n < MIN_OBSERVATIONS) return null;
  const a = assetReturns.slice(-n);
  const b = benchmarkReturns.slice(-n);
  const meanB = mean(b);
  let cov = 0, varB = 0;
  const meanA = mean(a);
  for (let i = 0; i < n; i++) {
    cov += (a[i] - meanA) * (b[i] - meanB);
    varB += (b[i] - meanB) ** 2;
  }
  if (varB === 0) return null;
  return cov / varB;
}

export interface DrawdownResult {
  maxDrawdownPct: number;
  peakIndex: number;
  troughIndex: number;
}

/** Maximum peak-to-trough decline over a value series (portfolio value or price). */
export function computeMaxDrawdown(values: number[]): DrawdownResult | null {
  if (values.length < 2) return null;
  let peak = values[0];
  let peakIndex = 0;
  let maxDrawdownPct = 0;
  let troughIndex = 0;
  values.forEach((v, i) => {
    if (v > peak) {
      peak = v;
      peakIndex = i;
    }
    const drawdown = (v - peak) / peak;
    if (drawdown < maxDrawdownPct) {
      maxDrawdownPct = drawdown;
      troughIndex = i;
    }
  });
  return { maxDrawdownPct: Math.round(maxDrawdownPct * 1000) / 10, peakIndex, troughIndex };
}

export interface LiquidityInput {
  positionValue: number;
  avgDailyDollarVolume: number | null; // avg daily volume * price, from real data
}

/**
 * Flags a position as illiquid if it would take an unreasonable number of
 * average trading days to exit without materially moving the price (using
 * the common 10%-of-ADV heuristic). Returns null (not 0) when volume data
 * isn't available, so callers can show DATA UNAVAILABLE.
 */
export function computeLiquidityRisk(input: LiquidityInput): { daysToExit: number | null; risk: "LOW" | "MEDIUM" | "HIGH" | null } {
  if (input.avgDailyDollarVolume === null || input.avgDailyDollarVolume === 0) {
    return { daysToExit: null, risk: null };
  }
  const daysToExit = input.positionValue / (input.avgDailyDollarVolume * 0.1);
  const risk = daysToExit > 10 ? "HIGH" : daysToExit > 3 ? "MEDIUM" : "LOW";
  return { daysToExit: Math.round(daysToExit * 10) / 10, risk };
}
