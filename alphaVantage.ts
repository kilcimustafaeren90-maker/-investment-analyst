import {
  MarketDataProvider,
  FundamentalsProvider,
  Quote,
  OHLCV,
  CompanyProfile,
  BalanceSheetSnapshot,
  OverviewMetrics,
  SourcedValue,
  unavailable,
} from "./types";

const BASE_URL = "https://www.alphavantage.co/query";

function num(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export class AlphaVantageProvider implements MarketDataProvider, FundamentalsProvider {
  readonly name = "AlphaVantage";

  private get apiKey(): string | undefined {
    return process.env.MARKET_DATA_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async getQuote(symbol: string): Promise<SourcedValue<Quote>> {
    if (!this.isConfigured()) return unavailable(this.name);
    try {
      const url = `${BASE_URL}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(
        symbol
      )}&apikey=${this.apiKey}`;
      const res = await fetch(url, { next: { revalidate: 60 } });
      if (!res.ok) return { ...unavailable<Quote>(this.name), status: "ERROR" };
      const json = await res.json();
      const q = json["Global Quote"];
      if (!q || !q["05. price"]) return unavailable(this.name);
      return {
        value: {
          symbol,
          price: parseFloat(q["05. price"]),
          change: parseFloat(q["09. change"]),
          changePercent: parseFloat((q["10. change percent"] || "0").replace("%", "")),
          currency: "USD",
          timestamp: new Date().toISOString(),
        },
        status: "VALID",
        source: this.name,
        retrievedAt: new Date().toISOString(),
      };
    } catch {
      return { ...unavailable<Quote>(this.name), status: "ERROR" };
    }
  }

  async getHistoricalPrices(
    symbol: string,
    startDate: string,
    endDate: string,
    interval: "1d" | "1wk" | "1mo"
  ): Promise<SourcedValue<OHLCV[]>> {
    if (!this.isConfigured()) return unavailable(this.name);
    const fn =
      interval === "1d"
        ? "TIME_SERIES_DAILY"
        : interval === "1wk"
        ? "TIME_SERIES_WEEKLY"
        : "TIME_SERIES_MONTHLY";
    try {
      const url = `${BASE_URL}?function=${fn}&symbol=${encodeURIComponent(
        symbol
      )}&outputsize=full&apikey=${this.apiKey}`;
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (!res.ok) return { ...unavailable<OHLCV[]>(this.name), status: "ERROR" };
      const json = await res.json();
      const seriesKey = Object.keys(json).find((k) => k.toLowerCase().includes("time series"));
      if (!seriesKey) return unavailable(this.name);
      const series = json[seriesKey] as Record<string, Record<string, string>>;
      const bars: OHLCV[] = Object.entries(series)
        .map(([date, bar]) => ({
          timestamp: date,
          open: parseFloat(bar["1. open"]),
          high: parseFloat(bar["2. high"]),
          low: parseFloat(bar["3. low"]),
          close: parseFloat(bar["4. close"]),
          volume: bar["5. volume"] ? parseFloat(bar["5. volume"]) : null,
        }))
        .filter((b) => b.timestamp >= startDate && b.timestamp <= endDate)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      return {
        value: bars,
        status: bars.length ? "VALID" : "UNAVAILABLE",
        source: this.name,
        retrievedAt: new Date().toISOString(),
      };
    } catch {
      return { ...unavailable<OHLCV[]>(this.name), status: "ERROR" };
    }
  }

  async getCompany(symbol: string): Promise<SourcedValue<CompanyProfile>> {
    if (!this.isConfigured()) return unavailable(this.name);
    try {
      const url = `${BASE_URL}?function=OVERVIEW&symbol=${encodeURIComponent(
        symbol
      )}&apikey=${this.apiKey}`;
      const res = await fetch(url, { next: { revalidate: 86400 } });
      if (!res.ok) return { ...unavailable<CompanyProfile>(this.name), status: "ERROR" };
      const json = await res.json();
      if (!json.Symbol) return unavailable(this.name);
      return {
        value: {
          symbol: json.Symbol,
          name: json.Name,
          exchange: json.Exchange,
          country: json.Country || null,
          sector: json.Sector || null,
          industry: json.Industry || null,
          currency: json.Currency || "USD",
        },
        status: "VALID",
        source: this.name,
        retrievedAt: new Date().toISOString(),
      };
    } catch {
      return { ...unavailable<CompanyProfile>(this.name), status: "ERROR" };
    }
  }

  // Real BALANCE_SHEET endpoint — most recent annual report. Every field is
  // parsed defensively; Alpha Vantage returns the literal string "None" for
  // missing line items, which must become null, never 0 or a guess.
  async getBalanceSheet(symbol: string): Promise<SourcedValue<BalanceSheetSnapshot>> {
    if (!this.isConfigured()) return unavailable(this.name);
    try {
      const url = `${BASE_URL}?function=BALANCE_SHEET&symbol=${encodeURIComponent(
        symbol
      )}&apikey=${this.apiKey}`;
      const res = await fetch(url, { next: { revalidate: 86400 } });
      if (!res.ok) return { ...unavailable<BalanceSheetSnapshot>(this.name), status: "ERROR" };
      const json = await res.json();
      const report = json?.annualReports?.[0];
      if (!report) return unavailable(this.name);

      return {
        value: {
          periodEnd: report.fiscalDateEnding,
          totalAssets: num(report.totalAssets),
          totalLiabilities: num(report.totalLiabilities),
          shareholdersEquity: num(report.totalShareholderEquity),
          cash: num(report.cashAndCashEquivalentsAtCarryingValue),
          receivables: num(report.currentNetReceivables),
          inventory: num(report.inventory),
          propertyPlantEquipment: num(report.propertyPlantEquipment),
          investments: num(report.longTermInvestments),
          goodwill: num(report.goodwill),
          intangibleAssets: num(report.intangibleAssets),
          otherAssets: num(report.otherCurrentAssets),
        },
        status: "VALID",
        source: this.name,
        retrievedAt: new Date().toISOString(),
      };
    } catch {
      return { ...unavailable<BalanceSheetSnapshot>(this.name), status: "ERROR" };
    }
  }

  // Real OVERVIEW endpoint — gives most of what the book-value-vs-market
  // engine needs (market cap, P/B, EV/EBITDA, ROE...) in one call.
  async getOverviewMetrics(symbol: string): Promise<SourcedValue<OverviewMetrics>> {
    if (!this.isConfigured()) return unavailable(this.name);
    try {
      const url = `${BASE_URL}?function=OVERVIEW&symbol=${encodeURIComponent(
        symbol
      )}&apikey=${this.apiKey}`;
      const res = await fetch(url, { next: { revalidate: 86400 } });
      if (!res.ok) return { ...unavailable<OverviewMetrics>(this.name), status: "ERROR" };
      const json = await res.json();
      if (!json.Symbol) return unavailable(this.name);

      return {
        value: {
          symbol: json.Symbol,
          sharesOutstanding: num(json.SharesOutstanding),
          marketCapitalization: num(json.MarketCapitalization),
          peRatio: num(json.PERatio),
          pbRatio: num(json.PriceToBookRatio),
          evToEbitda: num(json.EVToEBITDA),
          evToRevenue: num(json.EVToRevenue),
          roe: num(json.ReturnOnEquityTTM),
          roa: num(json.ReturnOnAssetsTTM),
          bookValuePerShare: num(json.BookValue),
          dividendYield: num(json.DividendYield),
          profitMargin: num(json.ProfitMargin),
          sector: json.Sector || null,
          industry: json.Industry || null,
        },
        status: "VALID",
        source: this.name,
        retrievedAt: new Date().toISOString(),
      };
    } catch {
      return { ...unavailable<OverviewMetrics>(this.name), status: "ERROR" };
    }
  }
}
