export interface ScoreWeights {
  technical: number;
  fundamental: number;
  valuation: number;
  growth: number;
  momentum: number;
  news: number;
  risk: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  technical: 0.2,
  fundamental: 0.25,
  valuation: 0.15,
  growth: 0.15,
  momentum: 0.1,
  news: 0.1,
  risk: 0.05,
};

export interface ComponentScore {
  key: keyof ScoreWeights;
  value: number | null; // 0-100, null if not computable
}

export interface CompanyScoreResult {
  status: "SCORED" | "INSUFFICIENT_DATA";
  score: number | null;
  components: ComponentScore[];
  missing: (keyof ScoreWeights)[];
}

// Minimum fraction of total weight that must have real data before we're
// willing to produce a score at all. Below this, missing data would
// artificially skew the result — so we refuse instead.
const MIN_COVERAGE = 0.6;

export function computeCompanyScore(
  components: ComponentScore[],
  weights: ScoreWeights = DEFAULT_WEIGHTS
): CompanyScoreResult {
  const missing = components.filter((c) => c.value === null).map((c) => c.key);
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const coveredWeight = components
    .filter((c) => c.value !== null)
    .reduce((sum, c) => sum + weights[c.key], 0);

  if (coveredWeight / totalWeight < MIN_COVERAGE) {
    return { status: "INSUFFICIENT_DATA", score: null, components, missing };
  }

  // Re-normalize weights across only the components we actually have data
  // for, so missing data reduces confidence rather than silently boosting
  // (or penalizing) the score.
  const renormalizedWeight = coveredWeight;
  const score = components.reduce((sum, c) => {
    if (c.value === null) return sum;
    return sum + (c.value * weights[c.key]) / renormalizedWeight;
  }, 0);

  return {
    status: "SCORED",
    score: Math.round(score * 10) / 10,
    components,
    missing,
  };
}
