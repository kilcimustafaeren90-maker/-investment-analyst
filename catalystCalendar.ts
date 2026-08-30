export interface RawEvent {
  symbol: string;
  eventType: string;
  title: string;
  date: string; // ISO
  importance: "LOW" | "MEDIUM" | "HIGH";
  source: string;
}

export interface CalendarEntry extends RawEvent {
  daysAway: number;
  portfolioImpact: "HELD" | "WATCHLIST" | "NONE";
}

export interface CatalystCalendar {
  next7Days: CalendarEntry[];
  next30Days: CalendarEntry[];
  next90Days: CalendarEntry[];
}

/**
 * Buckets are inclusive and cumulative windows from "now". Only real
 * events (earnings dates, disclosures, central bank meetings, etc.) go
 * in — this function does not invent placeholder events for symbols
 * with no known upcoming catalyst.
 */
export function buildCatalystCalendar(
  events: RawEvent[],
  heldSymbols: string[],
  watchlistSymbols: string[],
  now: Date = new Date()
): CatalystCalendar {
  const withMeta: CalendarEntry[] = events
    .map((e) => {
      const daysAway = Math.round((new Date(e.date).getTime() - now.getTime()) / 86400000);
      const portfolioImpact: CalendarEntry["portfolioImpact"] = heldSymbols.includes(e.symbol)
        ? "HELD"
        : watchlistSymbols.includes(e.symbol)
        ? "WATCHLIST"
        : "NONE";
      return { ...e, daysAway, portfolioImpact };
    })
    .filter((e) => e.daysAway >= 0)
    .sort((a, b) => a.daysAway - b.daysAway);

  return {
    next7Days: withMeta.filter((e) => e.daysAway <= 7),
    next30Days: withMeta.filter((e) => e.daysAway <= 30),
    next90Days: withMeta.filter((e) => e.daysAway <= 90),
  };
}
