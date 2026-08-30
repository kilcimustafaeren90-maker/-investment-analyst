export type AlertType = "THESIS_WARNING" | "NEW_OPPORTUNITY" | "PORTFOLIO_RISK" | "IMPORTANT_NEWS" | "UPCOMING_EVENT";

export interface ProactiveAlert {
  type: AlertType;
  icon: "🚨";
  headline: string;
  detail: string;
  symbol: string | null;
  severity: "INFO" | "MODERATE" | "HIGH";
  detectedAt: string;
}

export interface AlertEngineInputs {
  thesisChanges: { symbol: string; previousStatus: string; newStatus: string; reason: string }[];
  buyTheDipActions: { symbol: string; reasons: string[] }[];
  riskWarnings: { label: string; currentPct: number; limitPct: number; why: string; status: "HIGH_RISK" | "ELEVATED" }[];
  highImpactNews: { symbol: string; headline: string; sentiment: string }[];
  imminentEvents: { symbol: string; title: string; daysAway: number }[]; // already filtered by caller to "within alert threshold"
}

/**
 * Every alert here is derived 1:1 from a real input the caller supplied —
 * this function does not itself decide that something is newsworthy from
 * price data; it only formats what upstream engines (thesis/risk/
 * recommendation/catalyst calendar) already detected.
 */
export function buildProactiveAlerts(inputs: AlertEngineInputs, now: Date = new Date()): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];
  const nowIso = now.toISOString();

  inputs.thesisChanges.forEach((t) => {
    if (t.newStatus === "WEAKENING" || t.newStatus === "AT_RISK" || t.newStatus === "BROKEN") {
      alerts.push({
        type: "THESIS_WARNING",
        icon: "🚨",
        headline: `THESIS WARNING — Your thesis for ${t.symbol} has ${t.newStatus === "BROKEN" ? "broken" : "weakened"}.`,
        detail: t.reason,
        symbol: t.symbol,
        severity: t.newStatus === "BROKEN" ? "HIGH" : t.newStatus === "AT_RISK" ? "HIGH" : "MODERATE",
        detectedAt: nowIso,
      });
    }
  });

  inputs.buyTheDipActions.forEach((b) => {
    alerts.push({
      type: "NEW_OPPORTUNITY",
      icon: "🚨",
      headline: `NEW OPPORTUNITY — ${b.symbol} has entered the BUY THE DIP zone.`,
      detail: b.reasons.join(" "),
      symbol: b.symbol,
      severity: "MODERATE",
      detectedAt: nowIso,
    });
  });

  inputs.riskWarnings.forEach((w) => {
    alerts.push({
      type: "PORTFOLIO_RISK",
      icon: "🚨",
      headline: `PORTFOLIO RISK — ${w.label} exposure has exceeded your configured limit.`,
      detail: `${w.currentPct.toFixed(0)}% vs a ${w.limitPct}% maximum. ${w.why}`,
      symbol: null,
      severity: w.status === "HIGH_RISK" ? "HIGH" : "MODERATE",
      detectedAt: nowIso,
    });
  });

  inputs.highImpactNews.forEach((n) => {
    alerts.push({
      type: "IMPORTANT_NEWS",
      icon: "🚨",
      headline: `IMPORTANT NEWS — ${n.symbol} released a material update.`,
      detail: n.headline,
      symbol: n.symbol,
      severity: n.sentiment === "NEGATIVE" ? "HIGH" : "MODERATE",
      detectedAt: nowIso,
    });
  });

  inputs.imminentEvents.forEach((e) => {
    alerts.push({
      type: "UPCOMING_EVENT",
      icon: "🚨",
      headline: `UPCOMING EVENT — ${e.symbol} ${e.title.toLowerCase()} ${e.daysAway === 0 ? "today" : e.daysAway === 1 ? "tomorrow" : `in ${e.daysAway} days`}.`,
      detail: `Source event scheduled ${e.daysAway === 0 ? "today" : `in ${e.daysAway} day(s)`}.`,
      symbol: e.symbol,
      severity: e.daysAway <= 1 ? "MODERATE" : "INFO",
      detectedAt: nowIso,
    });
  });

  const severityRank = { HIGH: 0, MODERATE: 1, INFO: 2 };
  return alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}
