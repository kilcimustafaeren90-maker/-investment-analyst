export interface DailySnapshot {
  date: string;
  positions: { symbol: string; quantity: number }[];
  thesisStatuses: Record<string, string>; // symbol -> ThesisStatus
  actions: Record<string, string>; // symbol -> AdvisorAction
}

export interface DailyReview {
  holdingsChanged: { symbol: string; change: "ADDED" | "REMOVED" | "QUANTITY_CHANGED"; detail: string }[];
  thesisChanged: { symbol: string; from: string; to: string }[];
  recommendationsChanged: { symbol: string; from: string; to: string }[];
  watchTomorrow: string[];
}

/**
 * A pure diff between two real stored snapshots (yesterday vs today) —
 * nothing here is inferred or predicted; it only reports what's different
 * between two DB-backed states. If yesterday's snapshot doesn't exist yet
 * (first day using the feature), the caller should show that honestly
 * rather than fabricating a comparison.
 */
export function buildDailyReview(yesterday: DailySnapshot, today: DailySnapshot, watchTomorrowCandidates: string[]): DailyReview {
  const holdingsChanged: DailyReview["holdingsChanged"] = [];
  const ySymbols = new Map(yesterday.positions.map((p) => [p.symbol, p.quantity]));
  const tSymbols = new Map(today.positions.map((p) => [p.symbol, p.quantity]));

  tSymbols.forEach((qty, symbol) => {
    if (!ySymbols.has(symbol)) {
      holdingsChanged.push({ symbol, change: "ADDED", detail: `New position opened (${qty} shares).` });
    } else if (ySymbols.get(symbol) !== qty) {
      holdingsChanged.push({ symbol, change: "QUANTITY_CHANGED", detail: `Position size changed from ${ySymbols.get(symbol)} to ${qty}.` });
    }
  });
  ySymbols.forEach((qty, symbol) => {
    if (!tSymbols.has(symbol)) {
      holdingsChanged.push({ symbol, change: "REMOVED", detail: "Position closed." });
    }
  });

  const thesisChanged: DailyReview["thesisChanged"] = [];
  Object.entries(today.thesisStatuses).forEach(([symbol, status]) => {
    const prior = yesterday.thesisStatuses[symbol];
    if (prior && prior !== status) thesisChanged.push({ symbol, from: prior, to: status });
  });

  const recommendationsChanged: DailyReview["recommendationsChanged"] = [];
  Object.entries(today.actions).forEach(([symbol, action]) => {
    const prior = yesterday.actions[symbol];
    if (prior && prior !== action) recommendationsChanged.push({ symbol, from: prior, to: action });
  });

  return { holdingsChanged, thesisChanged, recommendationsChanged, watchTomorrow: watchTomorrowCandidates };
}
