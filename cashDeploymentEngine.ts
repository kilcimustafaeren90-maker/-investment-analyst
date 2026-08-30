export type ValuationRegime = "CHEAP" | "FAIR" | "EXPENSIVE" | null;
export type MarketTrend = "UP" | "DOWN" | "SIDEWAYS" | null;
export type VolatilityRegime = "LOW" | "MEDIUM" | "HIGH" | null;
export type MacroStance = "TAILWIND" | "NEUTRAL" | "HEADWIND" | null;

export interface CashDeploymentInput {
  capitalPoolName: string;
  currency: string;
  availableCash: number;
  riskProfile: "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE";
  timeHorizon: "SHORT_TERM" | "MEDIUM_TERM" | "LONG_TERM";
  minCashPct: number; // from InvestorProfile — the floor this engine must respect
  // Market/opportunity context — each nullable, and null genuinely means
  // "not available", not zero. Missing inputs reduce confidence, they
  // never get treated as neutral/favorable by default.
  valuation: ValuationRegime;
  trend: MarketTrend;
  volatility: VolatilityRegime;
  macroStance: MacroStance;
  qualifiedOpportunityCount: number | null; // count of candidates scoring >=65 in this pool's allowed markets
  portfolioConcentrationBreachCount: number; // from riskEngine — already known, always available
  upcomingCatalystWithinDays: number | null; // days to nearest major catalyst affecting a qualified candidate, if any
}

export interface DeploymentBucket {
  label: "INVEST_NOW" | "GOLD" | "LOW_RISK_INSTRUMENTS" | "HOLD_RESERVE" | "PULLBACK_RESERVE" | "EARNINGS_EVENT_RESERVE" | "OPPORTUNITY_RESERVE";
  amount: number;
  pct: number;
  reason: string;
}

export interface CashDeploymentResult {
  capitalPoolName: string;
  currency: string;
  availableCash: number;
  deploymentReadinessScore: number; // 0-100
  buckets: DeploymentBucket[];
  staged: boolean;
  headline: string;
}

/**
 * 0-100 "how ready is now, for this pool" score. Deliberately conservative
 * by default — missing inputs pull the score toward caution rather than
 * confidence, and a genuinely poor opportunity set can drive this to
 * near-zero, at which point the engine recommends holding cash rather
 * than forcing a deployment.
 */
function computeReadinessScore(input: CashDeploymentInput): { score: number; missing: string[] } {
  let score = 50; // neutral baseline
  const missing: string[] = [];

  if (input.valuation === "CHEAP") score += 15;
  else if (input.valuation === "EXPENSIVE") score -= 20;
  else if (input.valuation === "FAIR") score += 0;
  else missing.push("market valuation");

  if (input.trend === "UP") score += 8;
  else if (input.trend === "DOWN") score -= 5; // a downtrend isn't automatically bad — see BUY THE DIP — but raises caution for fresh cash
  else if (input.trend === null) missing.push("market trend");

  if (input.volatility === "HIGH") score -= 15;
  else if (input.volatility === "LOW") score += 5;
  else if (input.volatility === null) missing.push("volatility regime");

  if (input.macroStance === "TAILWIND") score += 10;
  else if (input.macroStance === "HEADWIND") score -= 15;
  else if (input.macroStance === null) missing.push("macro stance");

  if (input.qualifiedOpportunityCount === null) {
    missing.push("opportunity scan");
  } else if (input.qualifiedOpportunityCount === 0) {
    score -= 30; // the single most important "don't force it" signal
  } else if (input.qualifiedOpportunityCount >= 3) {
    score += 10;
  }

  score -= input.portfolioConcentrationBreachCount * 8; // don't deploy into an already-concentrated portfolio

  if (input.timeHorizon === "LONG_TERM") score += 5;
  else if (input.timeHorizon === "SHORT_TERM") score -= 5;

  return { score: Math.max(0, Math.min(100, Math.round(score))), missing };
}

/**
 * Never mixes capital pools — operates on exactly one currency/pool at a
 * time, and every bucket amount is denominated in that pool's currency
 * only. Never forces deployment: at low readiness, INVEST_NOW can be 0.
 */
export function computeCashDeployment(input: CashDeploymentInput): CashDeploymentResult {
  const { score, missing } = computeReadinessScore(input);
  const cash = input.availableCash;
  const minCashAmount = cash * (input.minCashPct / 100);

  const buckets: DeploymentBucket[] = [];
  let investNowPct: number;
  let staged = false;
  let headline: string;

  if (score < 25) {
    investNowPct = 0;
    headline = `I would currently keep more cash rather than force an investment in ${input.capitalPoolName}.`;
  } else if (score < 45) {
    investNowPct = 0.1;
    staged = true;
    headline = `Conditions for ${input.capitalPoolName} are unattractive enough that most of this cash should stay in reserve, staged rather than deployed at once.`;
  } else if (score < 65) {
    investNowPct = 0.3;
    staged = true;
    headline = `Conditions are mixed for ${input.capitalPoolName} — a partial deployment now with the rest staged makes more sense than committing it all.`;
  } else if (score < 80) {
    investNowPct = 0.5;
    staged = true;
    headline = `Conditions are constructive for ${input.capitalPoolName} — deploying roughly half now with the remainder staged balances opportunity against risk.`;
  } else {
    investNowPct = 0.65;
    staged = true;
    headline = `Conditions are favorable for ${input.capitalPoolName} — a larger immediate allocation is justified, with a reserve still held back for flexibility.`;
  }

  const investNowAmount = Math.round(cash * investNowPct);
  buckets.push({
    label: "INVEST_NOW",
    amount: investNowAmount,
    pct: Math.round(investNowPct * 1000) / 10,
    reason:
      investNowPct === 0
        ? `Deployment readiness score is ${score}/100 — ${input.qualifiedOpportunityCount === 0 ? "no qualified opportunities currently clear your score threshold in this pool's allowed markets." : "current valuation/volatility/macro conditions don't clear the bar for fresh capital."}`
        : `Deployment readiness score is ${score}/100, supporting a ${(investNowPct * 100).toFixed(0)}% immediate allocation into the highest-scoring eligible candidates.`,
  });

  const remaining = cash - investNowAmount;

  if (input.riskProfile !== "AGGRESSIVE" && remaining > 0) {
    const goldAmount = Math.round(remaining * 0.15);
    buckets.push({
      label: "GOLD",
      amount: goldAmount,
      pct: Math.round((goldAmount / cash) * 1000) / 10,
      reason: "A partial gold allocation is held as a diversifier against currency and equity-market risk, sized to your risk profile.",
    });
  }

  if (remaining > 0) {
    const lowRiskAmount = Math.round(remaining * (input.riskProfile === "CONSERVATIVE" ? 0.35 : 0.2));
    buckets.push({
      label: "LOW_RISK_INSTRUMENTS",
      amount: lowRiskAmount,
      pct: Math.round((lowRiskAmount / cash) * 1000) / 10,
      reason: `Held in low-risk, ${input.currency}-denominated instruments to earn a return while staying deployable, consistent with your ${input.riskProfile.toLowerCase()} risk profile.`,
    });
  }

  const allocatedSoFar = buckets.reduce((s, b) => s + b.amount, 0);
  let reserve = cash - allocatedSoFar;

  if (staged && reserve > 0) {
    const pullback = Math.round(reserve * 0.35);
    const earnings = input.upcomingCatalystWithinDays !== null && input.upcomingCatalystWithinDays <= 45 ? Math.round(reserve * 0.25) : 0;
    const opportunity = Math.round(reserve * 0.2);
    const finalReserve = reserve - pullback - earnings - opportunity;

    buckets.push({
      label: "PULLBACK_RESERVE",
      amount: pullback,
      pct: Math.round((pullback / cash) * 1000) / 10,
      reason: "Reserved to deploy if a qualified candidate has a meaningful pullback with its thesis still intact — a BUY THE DIP trigger, not a fixed date.",
    });
    if (earnings > 0) {
      buckets.push({
        label: "EARNINGS_EVENT_RESERVE",
        amount: earnings,
        pct: Math.round((earnings / cash) * 1000) / 10,
        reason: `Reserved for deployment after an upcoming catalyst within ${input.upcomingCatalystWithinDays} days clarifies the picture for a qualified candidate.`,
      });
    }
    buckets.push({
      label: "OPPORTUNITY_RESERVE",
      amount: opportunity,
      pct: Math.round((opportunity / cash) * 1000) / 10,
      reason: "Held back for a new opportunity that doesn't yet exist in the current scan — discretionary dry powder.",
    });
    reserve = finalReserve;
  }

  if (reserve > 0 || buckets.length === 1) {
    buckets.push({
      label: "HOLD_RESERVE",
      amount: reserve,
      pct: Math.round((reserve / cash) * 1000) / 10,
      reason:
        reserve >= minCashAmount
          ? `Held as cash — comfortably above your configured ${input.minCashPct}% minimum liquidity buffer for this pool.`
          : `Held as cash, though this brings the pool close to your configured ${input.minCashPct}% minimum liquidity buffer — avoid deploying further without raising cash elsewhere.`,
    });
  }

  if (missing.length > 0) {
    headline += ` (Confidence reduced: ${missing.join(", ")} not currently available.)`;
  }

  return {
    capitalPoolName: input.capitalPoolName,
    currency: input.currency,
    availableCash: cash,
    deploymentReadinessScore: score,
    buckets: buckets.filter((b) => b.amount > 0 || b.label === "INVEST_NOW"),
    staged,
    headline,
  };
}
