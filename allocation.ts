export type RiskProfile = "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE";
export type TimeHorizon = "SHORT_TERM" | "MEDIUM_TERM" | "LONG_TERM";

export interface AllocationInput {
  capital: number;
  baseCurrency: string;
  riskProfile: RiskProfile;
  timeHorizon: TimeHorizon;
  countryPreference?: "US" | "TR" | "BOTH";
  maxSingleAssetPct?: number;
  maxSectorPct?: number;
  maxCurrencyExposurePct?: number;
}

export interface AllocationLine {
  assetClass: "US_EQUITY" | "TR_EQUITY" | "BONDS" | "GOLD" | "CASH";
  targetPct: number;
  amount: number;
}

export interface AllocationResult {
  input: AllocationInput;
  lines: AllocationLine[];
  notes: string[];
}

// Base allocation matrix by risk profile — this is the deterministic core.
// It is a starting template, not a guarantee; V1 does not yet factor in
// live volatility/correlation data (see V1 scope). That is a documented
// next step, not something the AI layer is allowed to fill in silently.
const BASE_MATRIX: Record<RiskProfile, Record<AllocationLine["assetClass"], number>> = {
  CONSERVATIVE: { US_EQUITY: 20, TR_EQUITY: 5, BONDS: 45, GOLD: 15, CASH: 15 },
  MODERATE: { US_EQUITY: 35, TR_EQUITY: 10, BONDS: 30, GOLD: 10, CASH: 15 },
  AGGRESSIVE: { US_EQUITY: 55, TR_EQUITY: 15, BONDS: 10, GOLD: 10, CASH: 10 },
};

// Longer horizons can absorb more equity risk; shift a few points from
// bonds/cash into equities/gold as horizon lengthens.
const HORIZON_TILT: Record<TimeHorizon, Partial<Record<AllocationLine["assetClass"], number>>> = {
  SHORT_TERM: { CASH: 10, BONDS: 5, US_EQUITY: -10, TR_EQUITY: -5 },
  MEDIUM_TERM: {},
  LONG_TERM: { US_EQUITY: 5, TR_EQUITY: 5, CASH: -5, BONDS: -5 },
};

export function computeAllocation(input: AllocationInput): AllocationResult {
  const notes: string[] = [];
  const base = { ...BASE_MATRIX[input.riskProfile] };
  const tilt = HORIZON_TILT[input.timeHorizon];

  for (const key of Object.keys(tilt) as (keyof typeof tilt)[]) {
    base[key] = (base[key] ?? 0) + (tilt[key] ?? 0);
  }

  if (input.countryPreference === "US") {
    base.US_EQUITY += base.TR_EQUITY;
    base.TR_EQUITY = 0;
    notes.push("US-only preference: Turkish equity allocation folded into US equities.");
  } else if (input.countryPreference === "TR") {
    base.TR_EQUITY += base.US_EQUITY;
    base.US_EQUITY = 0;
    notes.push("Turkey-only preference: US equity allocation folded into Turkish equities.");
  }

  // Clamp negatives and renormalize to exactly 100%.
  const classes = Object.keys(base) as (keyof typeof base)[];
  classes.forEach((c) => {
    if (base[c] < 0) base[c] = 0;
  });
  const total = classes.reduce((sum, c) => sum + base[c], 0);
  classes.forEach((c) => {
    base[c] = Math.round((base[c] / total) * 1000) / 10; // one decimal place
  });

  // Apply user-specified caps if given, redistributing the excess to CASH
  // so the total still reconciles to 100%.
  if (input.maxSingleAssetPct !== undefined) {
    classes.forEach((c) => {
      if (c !== "CASH" && base[c] > input.maxSingleAssetPct!) {
        const excess = base[c] - input.maxSingleAssetPct!;
        base[c] = input.maxSingleAssetPct!;
        base.CASH += excess;
        notes.push(`${c} capped at ${input.maxSingleAssetPct}% per your constraint; excess moved to cash.`);
      }
    });
  }

  const lines: AllocationLine[] = classes
    .filter((c) => base[c] > 0)
    .map((c) => ({
      assetClass: c,
      targetPct: base[c],
      amount: Math.round(input.capital * (base[c] / 100) * 100) / 100,
    }));

  notes.push(
    "Allocation is calculated from a risk/horizon template, not invented by the AI layer. Volatility/correlation-based optimization is a planned V2 upgrade."
  );

  return { input, lines, notes };
}

export interface CurrencyExposureLine {
  currency: string;
  pct: number;
}

export function computeCurrencyExposure(
  positions: { valueInBaseCurrency: number; tradingCurrency: string }[]
): CurrencyExposureLine[] {
  const total = positions.reduce((s, p) => s + p.valueInBaseCurrency, 0);
  if (total === 0) return [];
  const byCurrency = new Map<string, number>();
  positions.forEach((p) => {
    byCurrency.set(p.tradingCurrency, (byCurrency.get(p.tradingCurrency) ?? 0) + p.valueInBaseCurrency);
  });
  return Array.from(byCurrency.entries())
    .map(([currency, value]) => ({ currency, pct: Math.round((value / total) * 1000) / 10 }))
    .sort((a, b) => b.pct - a.pct);
}

export function computeAllocationDrift(
  target: { assetClass: string; targetPct: number }[],
  current: { assetClass: string; currentPct: number }[]
): { assetClass: string; targetPct: number; currentPct: number; driftPct: number }[] {
  return target.map((t) => {
    const c = current.find((x) => x.assetClass === t.assetClass);
    const currentPct = c?.currentPct ?? 0;
    return {
      assetClass: t.assetClass,
      targetPct: t.targetPct,
      currentPct,
      driftPct: Math.round((currentPct - t.targetPct) * 10) / 10,
    };
  });
}
