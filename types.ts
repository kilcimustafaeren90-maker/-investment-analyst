// Core provider interfaces. The analysis/AI layers depend ONLY on these
// types, never on a specific vendor SDK. Swapping Alpha Vantage for another
// vendor means writing one new file that implements these interfaces —
// nothing else in the app changes.

export type DataStatus = "VALID" | "STALE" | "UNAVAILABLE" | "ERROR";

export interface SourcedValue<T> {
  value: T | null;
  status: DataStatus;
  source: string;
  retrievedAt: string; // ISO timestamp
  currency?: string;
}

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  timestamp: string;
}

export interface OHLCV {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface CompanyProfile {
  symbol: string;
  name: string;
  exchange: string;
  country: string | null;
  sector: string | null;
  industry: string | null;
  currency: string;
}

export interface MarketDataProvider {
  readonly name: string;
  isConfigured(): boolean;
  getQuote(symbol: string): Promise<SourcedValue<Quote>>;
  getHistoricalPrices(
    symbol: string,
    startDate: string,
    endDate: string,
    interval: "1d" | "1wk" | "1mo"
  ): Promise<SourcedValue<OHLCV[]>>;
  getCompany(symbol: string): Promise<SourcedValue<CompanyProfile>>;
}

export interface FXProvider {
  readonly name: string;
  isConfigured(): boolean;
  getRate(base: string, quote: string): Promise<SourcedValue<number>>;
}

export interface GoldDataProvider {
  readonly name: string;
  isConfigured(): boolean;
  getSpotPriceUSDPerOunce(): Promise<SourcedValue<number>>;
}

export interface NewsItem {
  headline: string;
  url: string;
  source: string;
  publishedAt: string;
  summary?: string;
}

export interface NewsProvider {
  readonly name: string;
  isConfigured(): boolean;
  getNewsForSymbol(symbol: string, limit?: number): Promise<SourcedValue<NewsItem[]>>;
}

export interface MacroSeriesPoint {
  date: string;
  value: number;
}

export interface MacroDataProvider {
  readonly name: string;
  isConfigured(): boolean;
  getSeries(seriesId: string): Promise<SourcedValue<MacroSeriesPoint[]>>;
}

export interface RegulatoryFilingsProvider {
  readonly name: string;
  isConfigured(): boolean;
  getRecentFilings(identifier: string, limit?: number): Promise<SourcedValue<Array<{
    filingType: string;
    filedAt: string;
    url: string;
  }>>>;
}

// --- Fundamentals / balance sheet data, for the book-value-vs-market-value
// engine. Never fabricated: every field is nullable and comes from a real
// filing/overview endpoint, or is null with status UNAVAILABLE.

export interface BalanceSheetSnapshot {
  periodEnd: string;
  totalAssets: number | null;
  totalLiabilities: number | null;
  shareholdersEquity: number | null;
  cash: number | null;
  receivables: number | null;
  inventory: number | null;
  propertyPlantEquipment: number | null;
  investments: number | null;
  goodwill: number | null;
  intangibleAssets: number | null;
  otherAssets: number | null;
}

export interface OverviewMetrics {
  symbol: string;
  sharesOutstanding: number | null;
  marketCapitalization: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  evToEbitda: number | null;
  evToRevenue: number | null;
  roe: number | null;
  roa: number | null;
  bookValuePerShare: number | null;
  dividendYield: number | null;
  profitMargin: number | null;
  sector: string | null;
  industry: string | null;
}

export interface FundamentalsProvider {
  readonly name: string;
  isConfigured(): boolean;
  getBalanceSheet(symbol: string): Promise<SourcedValue<BalanceSheetSnapshot>>;
  getOverviewMetrics(symbol: string): Promise<SourcedValue<OverviewMetrics>>;
}

export function unavailable<T>(source: string): SourcedValue<T> {
  return {
    value: null,
    status: "UNAVAILABLE",
    source,
    retrievedAt: new Date().toISOString(),
  };
}

// --- Phase 2: full normalized envelope with source transparency ---

export type SourceType = "PRIMARY_REGULATORY" | "COMPANY_IR" | "EXCHANGE" | "LICENSED_MARKET_DATA" | "NEWS" | "ESTIMATE";
export type DataQuality = "HIGH" | "MEDIUM" | "LOW" | "ESTIMATE";

/**
 * The full normalized envelope every data point should eventually carry.
 * SourcedValue<T> above remains the lighter-weight shape used by the
 * original V1 providers; NormalizedDataPoint<T> is the Phase 2 shape with
 * full source transparency (VIEW SOURCE), period, and confidence — new
 * providers (SEC, KAP, news, commodities, company registry) return this.
 */
export interface NormalizedDataPoint<T> {
  value: T | null;
  currency: string | null;
  source: string; // e.g. "SEC EDGAR", "KAP", "Alpha Vantage"
  sourceType: SourceType;
  sourceUrl: string | null; // for "VIEW SOURCE" — null if not legally/technically linkable
  retrievedAt: string; // when the app fetched it
  period: string | null; // e.g. "Q2 2026", "FY2025"
  dataTimestamp: string | null; // when the underlying data point was as-of, per the source
  dataQuality: DataQuality;
  confidence: number | null; // 0-100
  provider: string; // provider class name, e.g. "AlphaVantageProvider", "SECEdgarProvider"
  status: DataStatus;
}

export function notConnected<T>(provider: string, sourceType: SourceType = "LICENSED_MARKET_DATA"): NormalizedDataPoint<T> {
  return {
    value: null,
    currency: null,
    source: provider,
    sourceType,
    sourceUrl: null,
    retrievedAt: new Date().toISOString(),
    period: null,
    dataTimestamp: null,
    dataQuality: "LOW",
    confidence: null,
    provider,
    status: "UNAVAILABLE",
  };
}

export interface CompanyMasterRecord {
  companyId: string;
  ticker: string;
  exchange: string;
  country: string;
  currency: string;
  companyName: string;
  isin: string | null;
  securityType: string;
  sector: string | null;
  industry: string | null;
  active: boolean;
  listingDate: string | null;
  delistingDate: string | null;
  lastUpdated: string;
}

export interface CompanyRegistryProvider {
  readonly name: string;
  isConfigured(): boolean;
  searchCompanies(query: string, limit?: number): Promise<NormalizedDataPoint<CompanyMasterRecord[]>>;
  getCompany(ticker: string): Promise<NormalizedDataPoint<CompanyMasterRecord>>;
}

export interface CommodityDataProvider {
  readonly name: string;
  isConfigured(): boolean;
  getSpotPrice(commodity: "GOLD" | "SILVER" | "OIL_BRENT"): Promise<NormalizedDataPoint<{ price: number; unit: string }>>;
}
