export type Recommendation =
  | "STRONG_BUY"
  | "BUY"
  | "HOLD"
  | "SELL"
  | "STRONG_SELL"
  | "INSUFFICIENT_DATA";

export type Confidence = "LOW" | "MEDIUM" | "HIGH";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface RiskModifierInput {
  extremeVolatility?: boolean;
  earningsImminent?: boolean;
  majorRegulatoryEvent?: boolean;
  liquidityProblems?: boolean;
  severeValuationDistortion?: boolean;
  abnormalPriceMovement?: boolean;
  dataUncertainty?: boolean;
}

export interface SignalResult {
  recommendation: Recommendation;
  score: number | null;
  confidence: Confidence;
  risk: RiskLevel;
  keyReasons: string[];
  keyRisks: string[];
}

function baseRecommendationFromScore(score: number): Exclude<Recommendation, "INSUFFICIENT_DATA"> {
  if (score >= 80) return "STRONG_BUY";
  if (score >= 65) return "BUY";
  if (score >= 50) return "HOLD";
  if (score >= 35) return "SELL";
  return "STRONG_SELL";
}

const DOWNGRADE_ORDER: Recommendation[] = [
  "STRONG_BUY",
  "BUY",
  "HOLD",
  "SELL",
  "STRONG_SELL",
];

function downgrade(rec: Recommendation, steps: number): Recommendation {
  if (rec === "INSUFFICIENT_DATA") return rec;
  const idx = DOWNGRADE_ORDER.indexOf(rec);
  const newIdx = Math.min(DOWNGRADE_ORDER.length - 1, idx + steps);
  return DOWNGRADE_ORDER[newIdx];
}

export function generateSignal(
  score: number | null,
  risk: RiskModifierInput,
  reasons: string[] = []
): SignalResult {
  if (score === null) {
    return {
      recommendation: "INSUFFICIENT_DATA",
      score: null,
      confidence: "LOW",
      risk: "HIGH",
      keyReasons: reasons,
      keyRisks: ["Insufficient underlying data to generate a reliable signal."],
    };
  }

  let recommendation: Recommendation = baseRecommendationFromScore(score);
  const keyRisks: string[] = [];
  let downgradeSteps = 0;
  let riskLevel: RiskLevel = "LOW";

  if (risk.extremeVolatility) {
    downgradeSteps += 1;
    riskLevel = "HIGH";
    keyRisks.push("Extreme recent volatility increases the chance of the signal reversing quickly.");
  }
  if (risk.earningsImminent) {
    keyRisks.push("An earnings report is imminent and could materially change the picture.");
    riskLevel = riskLevel === "HIGH" ? riskLevel : "MEDIUM";
  }
  if (risk.majorRegulatoryEvent) {
    downgradeSteps += 1;
    riskLevel = "HIGH";
    keyRisks.push("A major regulatory event is pending or recently occurred.");
  }
  if (risk.liquidityProblems) {
    downgradeSteps += 2;
    riskLevel = "HIGH";
    keyRisks.push("Liquidity concerns detected — position sizing and exit risk are elevated.");
  }
  if (risk.severeValuationDistortion) {
    downgradeSteps += 1;
    riskLevel = riskLevel === "HIGH" ? riskLevel : "MEDIUM";
    keyRisks.push("Valuation appears severely distorted relative to fundamentals or peers.");
  }
  if (risk.abnormalPriceMovement) {
    downgradeSteps += 1;
    riskLevel = riskLevel === "HIGH" ? riskLevel : "MEDIUM";
    keyRisks.push("Abnormal price movement detected — may reflect information not yet in fundamentals.");
  }
  if (risk.dataUncertainty) {
    keyRisks.push("Some underlying data is stale or unavailable, reducing confidence in this signal.");
  }

  if (downgradeSteps > 0) {
    recommendation = downgrade(recommendation, downgradeSteps);
  }

  const flaggedRiskCount = Object.values(risk).filter(Boolean).length;
  let confidence: Confidence = "HIGH";
  if (flaggedRiskCount >= 3 || risk.dataUncertainty) confidence = "LOW";
  else if (flaggedRiskCount >= 1) confidence = "MEDIUM";

  return {
    recommendation,
    score,
    confidence,
    risk: riskLevel,
    keyReasons: reasons,
    keyRisks,
  };
}
