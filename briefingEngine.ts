import { ProactiveAlert } from "./alertEngine";

export interface BriefingInputs {
  portfolioHealth: number;
  riskLabel: string;
  availableCash: number;
  currency: string;
  marketEnvironment: string; // e.g. "Neutral" or "DATA UNAVAILABLE — connect a macro data provider"
  alerts: ProactiveAlert[];
  actions: { action: string; symbol: string; reasons: string[] }[];
  riskWarnings: { label: string; currentPct: number; limitPct: number }[];
  opportunities: { symbol: string; score: number }[];
}

export interface DailyBriefing {
  greeting: "GOOD MORNING";
  portfolioHealth: number;
  riskLabel: string;
  availableCash: number;
  currency: string;
  marketEnvironment: string;
  threeThings: string[]; // top 3 alerts, by severity — never padded with filler if fewer than 3 exist
  whatIWouldDoToday: { action: string; symbol: string; reason: string }[];
  importantRisks: string[];
  newOpportunities: { symbol: string; score: number }[];
}

/**
 * Pure composition — every field here traces back to a real engine
 * output the caller passed in. If there are fewer than 3 alerts, this
 * returns fewer than 3 "things to know" rather than manufacturing filler.
 */
export function buildDailyBriefing(inputs: BriefingInputs): DailyBriefing {
  return {
    greeting: "GOOD MORNING",
    portfolioHealth: inputs.portfolioHealth,
    riskLabel: inputs.riskLabel,
    availableCash: inputs.availableCash,
    currency: inputs.currency,
    marketEnvironment: inputs.marketEnvironment,
    threeThings: inputs.alerts.slice(0, 3).map((a) => a.headline),
    whatIWouldDoToday: inputs.actions
      .filter((a) => a.action !== "HOLD" && a.action !== "WAIT")
      .map((a) => ({ action: a.action, symbol: a.symbol, reason: a.reasons[0] ?? "" })),
    importantRisks: inputs.riskWarnings.map((w) => `${w.label} exposure is ${w.currentPct.toFixed(0)}%, above your ${w.limitPct}% maximum.`),
    newOpportunities: inputs.opportunities,
  };
}
