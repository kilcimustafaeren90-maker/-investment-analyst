import { AdvisorAction } from "./recommendationEngine";

export interface EvidenceInputs {
  action: AdvisorAction;
  priceDeclinePct: number | null;
  fundamentalsVerdict: "STRONG" | "STABLE" | "WEAK" | null;
  revenueGrowthPct: number | null;
  fcfGrowthPct: number | null;
  pToB: number | null;
  newsVerdict: "NO_MAJOR_NEGATIVE" | "NEGATIVE_EVENT" | "UNKNOWN" | null;
  thesisStatus: "STRONG" | "INTACT" | "WEAKENING" | "AT_RISK" | "BROKEN" | null;
  portfolioImpact: "ACCEPTABLE" | "INCREASES_CONCENTRATION" | "UNKNOWN" | null;
}

export interface EvidenceLine {
  label: string;
  value: string;
}

export interface WhyRecommendation {
  headline: string;
  lines: EvidenceLine[];
  conclusion: string;
}

const NA = "DATA UNAVAILABLE";

/**
 * Produces exactly the factual, line-by-line format the spec asks for —
 * decline %, fundamentals verdict, growth, FCF, P/B, news, thesis,
 * portfolio impact, then one plain-language conclusion. This is the
 * user-facing evidence, not the model's internal reasoning trace.
 */
export function buildWhyRecommendation(symbol: string, e: EvidenceInputs): WhyRecommendation {
  const lines: EvidenceLine[] = [
    { label: "Price decline", value: e.priceDeclinePct !== null ? `${e.priceDeclinePct.toFixed(1)}%` : NA },
    { label: "Fundamentals", value: e.fundamentalsVerdict ?? NA },
    { label: "Revenue growth", value: e.revenueGrowthPct !== null ? `${e.revenueGrowthPct >= 0 ? "+" : ""}${e.revenueGrowthPct.toFixed(1)}%` : NA },
    { label: "FCF growth", value: e.fcfGrowthPct !== null ? `${e.fcfGrowthPct >= 0 ? "+" : ""}${e.fcfGrowthPct.toFixed(1)}%` : NA },
    { label: "P/B", value: e.pToB !== null ? `${e.pToB.toFixed(2)}x` : NA },
    { label: "News", value: e.newsVerdict === "NO_MAJOR_NEGATIVE" ? "No major structural negative event" : e.newsVerdict === "NEGATIVE_EVENT" ? "Negative event detected" : NA },
    { label: "Investment thesis", value: e.thesisStatus ? e.thesisStatus.replace("_", " ") : NA },
    { label: "Portfolio impact", value: e.portfolioImpact === "ACCEPTABLE" ? "Acceptable" : e.portfolioImpact === "INCREASES_CONCENTRATION" ? "Increases concentration beyond limit" : NA },
  ];

  const unavailableCount = lines.filter((l) => l.value === NA).length;
  const dataCaveat = unavailableCount > 0 ? ` (${unavailableCount} of ${lines.length} inputs unavailable — confidence reduced accordingly.)` : "";

  let conclusion: string;
  switch (e.action) {
    case "BUY_THE_DIP":
      conclusion =
        `The price decline in ${symbol} currently appears more consistent with a valuation reset than a deterioration in the underlying investment thesis.${dataCaveat}`;
      break;
    case "SELL":
      conclusion = `New information has broken the original investment thesis for ${symbol}; the case for holding no longer stands as originally made.${dataCaveat}`;
      break;
    case "REDUCE":
      conclusion = `${symbol} either scores weakly on the composite model or pushes portfolio concentration past your configured limit — trimming is the more defensible action than holding at full size.${dataCaveat}`;
      break;
    case "BUY":
      conclusion = `${symbol} scores strongly across technical, fundamental, valuation, and book-value inputs with no offsetting risk flag.${dataCaveat}`;
      break;
    case "HOLD":
      conclusion = `${symbol}'s composite picture is favorable but not strong enough to justify adding — staying at current size is the more defensible action.${dataCaveat}`;
      break;
    case "WATCH":
      conclusion = `${symbol} is not currently held and does not yet clear the bar for a new position — worth monitoring rather than acting on.${dataCaveat}`;
      break;
    case "NOT_ELIGIBLE":
      conclusion = `${symbol} falls outside the markets this capital pool is allowed to invest in.`;
      break;
    default:
      conclusion = `No strong case to act on ${symbol} today.${dataCaveat}`;
  }

  return { headline: `${e.action.replace(/_/g, " ")} — ${symbol}`, lines, conclusion };
}
