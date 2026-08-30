export type ThesisStatus = "STRONG" | "INTACT" | "WEAKENING" | "AT_RISK" | "BROKEN";

export type ThesisEventCategory =
  | "REVENUE"
  | "EARNINGS"
  | "MARGINS"
  | "FCF"
  | "DEBT"
  | "GUIDANCE"
  | "MANAGEMENT"
  | "KAP"
  | "SEC"
  | "NEWS"
  | "REGULATORY"
  | "CONTRACT"
  | "MNA"
  | "CAPITAL_INCREASE"
  | "BUYBACK"
  | "DIVIDEND"
  | "LEGAL"
  | "CUSTOMER_LOSS"
  | "INDUSTRY";

export type EventSeverity = "MINOR" | "MODERATE" | "SEVERE";

export interface ThesisEventInput {
  category: ThesisEventCategory;
  detail: string;
  severity: EventSeverity;
  source: string; // e.g. "KAP", "SEC 10-Q", "Company IR", "Reuters"
}

export interface ThesisRecord {
  rationale: string;
  invalidationConditions: string[];
  financialAssumptions: Record<string, number>;
}

// Categories that, on their own at SEVERE severity, are treated as an
// outright thesis break regardless of how many other assumptions still
// hold — these are the "accounting issue" / "major regulatory action"
// style events called out in the spec.
const BREAK_ALONE_CATEGORIES: ThesisEventCategory[] = ["SEC", "REGULATORY", "LEGAL"];

// Each event's contribution to a 0-100 "degradation score". Severity
// multiplies the base weight. This score, not a single event in
// isolation, drives the status transition — matching the example
// ("three assumptions have deteriorated" implies a cumulative read).
const CATEGORY_WEIGHT: Record<ThesisEventCategory, number> = {
  REVENUE: 18,
  EARNINGS: 16,
  MARGINS: 14,
  FCF: 14,
  DEBT: 12,
  GUIDANCE: 20,
  MANAGEMENT: 10,
  KAP: 8,
  SEC: 8,
  NEWS: 6,
  REGULATORY: 20,
  CONTRACT: 10,
  MNA: 15,
  CAPITAL_INCREASE: 8,
  BUYBACK: -6, // buybacks are typically supportive, so they reduce degradation
  DIVIDEND: -4,
  LEGAL: 18,
  CUSTOMER_LOSS: 16,
  INDUSTRY: 10,
};

const SEVERITY_MULTIPLIER: Record<EventSeverity, number> = { MINOR: 0.4, MODERATE: 1, SEVERE: 1.8 };

export interface ThesisEvaluation {
  status: ThesisStatus;
  previousStatus: ThesisStatus;
  degradationScore: number; // cumulative, 0-100+, clamped for display
  triggeredEvents: ThesisEventInput[];
  deterioratedAssumptionCount: number;
}

/**
 * Never reassesses on price movement alone — only concrete monitored
 * events (see ThesisEventCategory) move the needle, matching the spec's
 * "do not sell simply because price falls" requirement.
 */
export function evaluateThesis(
  currentStatus: ThesisStatus,
  priorDegradationScore: number,
  newEvents: ThesisEventInput[]
): ThesisEvaluation {
  if (newEvents.length === 0) {
    return { status: currentStatus, previousStatus: currentStatus, degradationScore: priorDegradationScore, triggeredEvents: [], deterioratedAssumptionCount: 0 };
  }

  const eventDelta = newEvents.reduce(
    (sum, e) => sum + CATEGORY_WEIGHT[e.category] * SEVERITY_MULTIPLIER[e.severity],
    0
  );
  const degradationScore = Math.max(0, priorDegradationScore + eventDelta);

  const hasAloneBreak = newEvents.some((e) => BREAK_ALONE_CATEGORIES.includes(e.category) && e.severity === "SEVERE");
  const deterioratedAssumptionCount = newEvents.filter((e) => CATEGORY_WEIGHT[e.category] > 0).length;

  let status: ThesisStatus;
  if (hasAloneBreak || degradationScore >= 75) status = "BROKEN";
  else if (degradationScore >= 50) status = "AT_RISK";
  else if (degradationScore >= 25) status = "WEAKENING";
  else if (degradationScore <= 5 && newEvents.every((e) => CATEGORY_WEIGHT[e.category] <= 0)) status = "STRONG";
  else status = "INTACT";

  return {
    status,
    previousStatus: currentStatus,
    degradationScore: Math.min(100, degradationScore),
    triggeredEvents: newEvents,
    deterioratedAssumptionCount,
  };
}

export interface ThesisWarning {
  headline: string;
  originalThesis: string;
  newEvidence: string[];
  impact: string;
  severity: EventSeverity | "CRITICAL";
  recommendedAction: "HOLD" | "REDUCE" | "SELL" | "WATCH";
}

const RECOMMENDED_ACTION_BY_STATUS: Record<ThesisStatus, ThesisWarning["recommendedAction"]> = {
  STRONG: "HOLD",
  INTACT: "HOLD",
  WEAKENING: "WATCH",
  AT_RISK: "REDUCE",
  BROKEN: "SELL",
};

/**
 * Builds the user-facing ⚠️ INVESTMENT THESIS WARNING — factual evidence
 * and a conclusion only, never the model's internal reasoning trace.
 */
export function buildThesisWarning(
  thesis: ThesisRecord,
  evaluation: ThesisEvaluation
): ThesisWarning | null {
  if (evaluation.status === evaluation.previousStatus || evaluation.triggeredEvents.length === 0) {
    return null;
  }

  const severity: ThesisWarning["severity"] =
    evaluation.status === "BROKEN" ? "CRITICAL" : evaluation.triggeredEvents.some((e) => e.severity === "SEVERE") ? "SEVERE" : evaluation.triggeredEvents.some((e) => e.severity === "MODERATE") ? "MODERATE" : "MINOR";

  const headline =
    evaluation.deterioratedAssumptionCount > 1
      ? `${evaluation.deterioratedAssumptionCount} assumptions supporting the original thesis have deteriorated.`
      : evaluation.triggeredEvents[0]
      ? evaluation.triggeredEvents[0].detail
      : "The thesis has changed on new information.";

  return {
    headline,
    originalThesis: thesis.rationale,
    newEvidence: evaluation.triggeredEvents.map((e) => `[${e.source}] ${e.detail}`),
    impact: `Thesis moved from ${evaluation.previousStatus} to ${evaluation.status}.`,
    severity,
    recommendedAction: RECOMMENDED_ACTION_BY_STATUS[evaluation.status],
  };
}
