import { OHLCV } from "../providers/types";

// All functions here are pure and deterministic — never routed through the
// AI layer (see rule: RSI/MACD/SMA/etc. must be calculated in code, not
// asked of an LLM).

export function sma(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const window = closes.slice(i - period + 1, i + 1);
    return window.reduce((a, b) => a + b, 0) / period;
  });
}

export function ema(closes: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  closes.forEach((price, i) => {
    if (i < period - 1) {
      out.push(null);
      return;
    }
    if (prev === null) {
      const seed = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
      prev = seed;
      out.push(seed);
      return;
    }
    prev = price * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): { macdLine: (number | null)[]; signalLine: (number | null)[]; histogram: (number | null)[] } {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? (emaFast[i] as number) - (emaSlow[i] as number) : null
  );
  const macdValues = macdLine.map((v) => v ?? 0);
  const signalRaw = ema(macdValues, signalPeriod);
  const signalLine = macdLine.map((v, i) => (v !== null ? signalRaw[i] : null));
  const histogram = macdLine.map((v, i) =>
    v !== null && signalLine[i] !== null ? v - (signalLine[i] as number) : null
  );
  return { macdLine, signalLine, histogram };
}

export function bollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const middle = sma(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  closes.forEach((_, i) => {
    if (middle[i] === null) {
      upper.push(null);
      lower.push(null);
      return;
    }
    const window = closes.slice(i - period + 1, i + 1);
    const mean = middle[i] as number;
    const variance = window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    upper.push(mean + stdDevMultiplier * stdDev);
    lower.push(mean - stdDevMultiplier * stdDev);
  });
  return { upper, middle, lower };
}

export function atr(bars: OHLCV[], period = 14): (number | null)[] {
  const trueRanges: number[] = bars.map((bar, i) => {
    if (i === 0) return bar.high - bar.low;
    const prevClose = bars[i - 1].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
  });
  return sma(trueRanges, period);
}

export function adx(bars: OHLCV[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length < period + 1) return out;
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(
      Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close)
      )
    );
  }
  const smoothedTR = sma(tr, period);
  const smoothedPlusDM = sma(plusDM, period);
  const smoothedMinusDM = sma(minusDM, period);
  const dx: (number | null)[] = bars.map((_, i) => {
    if (!smoothedTR[i] || smoothedPlusDM[i] === null || smoothedMinusDM[i] === null) return null;
    const plusDI = (100 * (smoothedPlusDM[i] as number)) / (smoothedTR[i] as number);
    const minusDI = (100 * (smoothedMinusDM[i] as number)) / (smoothedTR[i] as number);
    const sum = plusDI + minusDI;
    return sum === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / sum;
  });
  return sma(
    dx.map((v) => v ?? 0),
    period
  );
}

export function stochastic(
  bars: OHLCV[],
  period = 14,
  smoothing = 3
): { k: (number | null)[]; d: (number | null)[] } {
  const k: (number | null)[] = bars.map((_, i) => {
    if (i < period - 1) return null;
    const window = bars.slice(i - period + 1, i + 1);
    const highestHigh = Math.max(...window.map((b) => b.high));
    const lowestLow = Math.min(...window.map((b) => b.low));
    if (highestHigh === lowestLow) return 50;
    return (100 * (bars[i].close - lowestLow)) / (highestHigh - lowestLow);
  });
  const d = sma(
    k.map((v) => v ?? 0),
    smoothing
  ).map((v, i) => (k[i] === null ? null : v));
  return { k, d };
}

export function obv(bars: OHLCV[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const prev = out[i - 1];
    const vol = bars[i].volume ?? 0;
    if (bars[i].close > bars[i - 1].close) out.push(prev + vol);
    else if (bars[i].close < bars[i - 1].close) out.push(prev - vol);
    else out.push(prev);
  }
  return out;
}

export function volumeSMA(bars: OHLCV[], period = 20): (number | null)[] {
  return sma(bars.map((b) => b.volume ?? 0), period);
}

export function detectGoldenCross(sma50: (number | null)[], sma200: (number | null)[]): boolean {
  const n = sma50.length;
  if (n < 2) return false;
  const a = sma50[n - 2],
    b = sma50[n - 1],
    c = sma200[n - 2],
    d = sma200[n - 1];
  if (a === null || b === null || c === null || d === null) return false;
  return a <= c && b > d;
}

export function detectDeathCross(sma50: (number | null)[], sma200: (number | null)[]): boolean {
  const n = sma50.length;
  if (n < 2) return false;
  const a = sma50[n - 2],
    b = sma50[n - 1],
    c = sma200[n - 2],
    d = sma200[n - 1];
  if (a === null || b === null || c === null || d === null) return false;
  return a >= c && b < d;
}

export function detectBreakout(bars: OHLCV[], lookback = 20): boolean {
  if (bars.length < lookback + 1) return false;
  const window = bars.slice(-lookback - 1, -1);
  const priorHigh = Math.max(...window.map((b) => b.high));
  return bars[bars.length - 1].close > priorHigh;
}

export function detectBreakdown(bars: OHLCV[], lookback = 20): boolean {
  if (bars.length < lookback + 1) return false;
  const window = bars.slice(-lookback - 1, -1);
  const priorLow = Math.min(...window.map((b) => b.low));
  return bars[bars.length - 1].close < priorLow;
}

export function trendDirection(closes: number[]): "UP" | "DOWN" | "SIDEWAYS" {
  const s = sma(closes, 50);
  const last = s[s.length - 1];
  const prior = s[s.length - 11]; // ~2 trading weeks earlier
  if (last === null || prior === null) return "SIDEWAYS";
  const pctChange = (last - prior) / prior;
  if (pctChange > 0.01) return "UP";
  if (pctChange < -0.01) return "DOWN";
  return "SIDEWAYS";
}
