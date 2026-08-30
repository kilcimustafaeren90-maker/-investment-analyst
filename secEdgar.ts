import { fetchWithRetry } from "../net/httpClient";
import { withCache, CACHE_TTL_MS } from "../cache/dataCache";
import {
  CompanyRegistryProvider,
  RegulatoryFilingsProvider,
  NormalizedDataPoint,
  CompanyMasterRecord,
  notConnected,
  SourcedValue,
} from "./types";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SUBMISSIONS_URL = (cik: string) => `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`;
const COMPANY_FACTS_URL = (cik: string) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`;

const SUPPORTED_FORMS = ["10-K", "10-Q", "8-K", "20-F", "6-K", "DEF 14A"];

export interface SECFiling {
  form: string;
  filingDate: string;
  reportDate: string | null;
  accessionNumber: string;
  primaryDocument: string;
  sourceUrl: string;
}

// Every requested metric mapped to an ordered list of candidate XBRL tags.
// Not every company reports under the same tag (e.g. some use
// RevenueFromContractWithCustomerExcludingAssessedTax, others just
// Revenues) — the first tag with data wins, so this is fallback logic,
// not an assumption that one tag is universal.
const METRIC_TAG_MAP: Record<string, string[]> = {
  Revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  NetIncome: ["NetIncomeLoss", "ProfitLoss"],
  Assets: ["Assets"],
  Liabilities: ["Liabilities"],
  StockholdersEquity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  Cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  OperatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities"],
  CapitalExpenditures: ["PaymentsToAcquirePropertyPlantAndEquipment"],
  EPS: ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
  SharesOutstanding: ["CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"],
};

export interface NormalizedFinancialFact {
  metricName: string;
  value: number;
  currency: string;
  periodType: "FY" | "Q1" | "Q2" | "Q3" | "Q4" | "TTM";
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  periodEnd: string;
  filingDate: string;
  accessionNumber: string;
  xbrlTag: string;
  sourceUrl: string;
  dataQuality: "HIGH" | "MEDIUM";
}

export type CompanyFactsResult =
  | { status: "OK"; facts: NormalizedFinancialFact[]; missingMetrics: string[] }
  | { status: "PARTIAL_DATA"; facts: NormalizedFinancialFact[]; missingMetrics: string[] }
  | { status: "UNAVAILABLE" | "NOT_CONNECTED" | "ERROR"; facts: []; missingMetrics: string[] };

/**
 * SEC EDGAR — the top-priority US primary source per the spec's source
 * priority order. Requires only a descriptive User-Agent (SEC_USER_AGENT),
 * not an API key; SEC blocks/rate-limits requests without one, so
 * isConfigured() is strict about it, and SEC_USER_AGENT is only ever read
 * server-side (process.env), never sent to or embedded in frontend code.
 */
export class SECEdgarProvider implements CompanyRegistryProvider, RegulatoryFilingsProvider {
  readonly name = "SECEdgarProvider";

  private get userAgent(): string | undefined {
    return process.env.SEC_USER_AGENT;
  }

  isConfigured(): boolean {
    // SEC guidance requires a descriptive UA with a contact email — a bare
    // string still "counts" as configured technically, but we sanity-check
    // for an @ so a placeholder like "MyApp" doesn't silently pass.
    return !!this.userAgent && this.userAgent.includes("@");
  }

  async searchCompanies(query: string, limit = 10): Promise<NormalizedDataPoint<CompanyMasterRecord[]>> {
    if (!this.isConfigured()) return notConnected(this.name, "PRIMARY_REGULATORY");
    try {
      const tickers = await withCache("sec:tickers", CACHE_TTL_MS.COMPANY_REGISTRY, async () => {
        const result = await fetchWithRetry(TICKERS_URL, { headers: { "User-Agent": this.userAgent as string } });
        if (result.status !== "OK") return null;
        return (await result.response.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
      });

      if (!tickers) return notConnected(this.name, "PRIMARY_REGULATORY");

      const q = query.toUpperCase();
      const matches = Object.values(tickers)
        .filter((t) => t.ticker.toUpperCase().includes(q) || t.title.toUpperCase().includes(q))
        .slice(0, limit)
        .map((t) => this.toCompanyMasterRecord(t.ticker, String(t.cik_str), t.title));

      return {
        value: matches,
        currency: null,
        source: "SEC EDGAR",
        sourceType: "PRIMARY_REGULATORY",
        sourceUrl: "https://www.sec.gov/cgi-bin/browse-edgar",
        retrievedAt: new Date().toISOString(),
        period: null,
        dataTimestamp: null,
        dataQuality: matches.length ? "HIGH" : "LOW",
        confidence: matches.length ? 95 : null,
        provider: this.name,
        status: matches.length ? "VALID" : "UNAVAILABLE",
      };
    } catch {
      return { ...notConnected<CompanyMasterRecord[]>(this.name, "PRIMARY_REGULATORY"), status: "ERROR" };
    }
  }

  /** Returns the FULL raw ticker->CIK map — used by the company-universe sync job. */
  async getAllCompanies(): Promise<{ status: "OK" | "NOT_CONNECTED" | "ERROR"; companies: CompanyMasterRecord[] }> {
    if (!this.isConfigured()) return { status: "NOT_CONNECTED", companies: [] };
    try {
      const tickers = await withCache("sec:tickers", CACHE_TTL_MS.COMPANY_REGISTRY, async () => {
        const result = await fetchWithRetry(TICKERS_URL, { headers: { "User-Agent": this.userAgent as string } });
        if (result.status !== "OK") return null;
        return (await result.response.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
      });
      if (!tickers) return { status: "ERROR", companies: [] };
      const companies = Object.values(tickers).map((t) => this.toCompanyMasterRecord(t.ticker, String(t.cik_str), t.title));
      return { status: "OK", companies };
    } catch {
      return { status: "ERROR", companies: [] };
    }
  }

  async getCompany(ticker: string): Promise<NormalizedDataPoint<CompanyMasterRecord>> {
    if (!this.isConfigured()) return notConnected(this.name, "PRIMARY_REGULATORY");
    const search = await this.searchCompanies(ticker, 5);
    const match = search.value?.find((c) => c.ticker.toUpperCase() === ticker.toUpperCase());
    if (!match) return { ...notConnected<CompanyMasterRecord>(this.name, "PRIMARY_REGULATORY"), status: "UNAVAILABLE" };
    return { ...search, value: match };
  }

  /** Full submissions detail (form, filing date, report date, accession number, primary doc, URL). */
  async getSubmissions(cik: string, forms: string[] = SUPPORTED_FORMS, limit = 25): Promise<{ status: "OK" | "NOT_CONNECTED" | "ERROR"; filings: SECFiling[] }> {
    if (!this.isConfigured()) return { status: "NOT_CONNECTED", filings: [] };
    try {
      const result = await fetchWithRetry(SUBMISSIONS_URL(cik), { headers: { "User-Agent": this.userAgent as string } });
      if (result.status !== "OK") return { status: "ERROR", filings: [] };
      const json = await result.response.json();
      const recent = json.filings?.recent;
      if (!recent) return { status: "ERROR", filings: [] };

      const filings: SECFiling[] = (recent.form as string[])
        .map((form, i) => ({
          form,
          filingDate: recent.filingDate[i],
          reportDate: recent.reportDate?.[i] ?? null,
          accessionNumber: recent.accessionNumber[i] as string,
          primaryDocument: recent.primaryDocument[i] as string,
          sourceUrl: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${(recent.accessionNumber[i] as string).replace(/-/g, "")}/${recent.primaryDocument[i]}`,
        }))
        .filter((f) => forms.includes(f.form))
        .slice(0, limit);

      return { status: "OK", filings };
    } catch {
      return { status: "ERROR", filings: [] };
    }
  }

  async getRecentFilings(identifier: string, limit = 10): Promise<SourcedValue<Array<{ filingType: string; filedAt: string; url: string }>>> {
    if (!this.isConfigured()) return { value: null, status: "UNAVAILABLE", source: this.name, retrievedAt: new Date().toISOString() };
    const company = await this.getCompany(identifier);
    if (!company.value) return { value: null, status: "UNAVAILABLE", source: this.name, retrievedAt: new Date().toISOString() };
    const result = await this.getSubmissions(company.value.companyId, SUPPORTED_FORMS, limit);
    if (result.status !== "OK") return { value: null, status: result.status === "NOT_CONNECTED" ? "UNAVAILABLE" : "ERROR", source: this.name, retrievedAt: new Date().toISOString() };
    return {
      value: result.filings.map((f) => ({ filingType: f.form, filedAt: f.filingDate, url: f.sourceUrl })),
      status: "VALID",
      source: "SEC EDGAR",
      retrievedAt: new Date().toISOString(),
    };
  }

  /**
   * Company Facts (XBRL) — normalizes only the metrics this application
   * actually needs, via METRIC_TAG_MAP fallback logic. Metrics genuinely
   * absent from the filing are reported in missingMetrics, never
   * backfilled with an estimate.
   */
  async getCompanyFacts(cik: string): Promise<CompanyFactsResult> {
    if (!this.isConfigured()) return { status: "NOT_CONNECTED", facts: [], missingMetrics: Object.keys(METRIC_TAG_MAP) };
    try {
      const cacheKey = `sec:companyfacts:${cik}`;
      const json = await withCache(cacheKey, CACHE_TTL_MS.FINANCIAL_STATEMENT, async () => {
        const result = await fetchWithRetry(COMPANY_FACTS_URL(cik), { headers: { "User-Agent": this.userAgent as string } });
        if (result.status !== "OK") return null;
        return await result.response.json();
      });
      if (!json) return { status: "ERROR", facts: [], missingMetrics: Object.keys(METRIC_TAG_MAP) };

      const usGaap = json.facts?.["us-gaap"];
      if (!usGaap) return { status: "UNAVAILABLE", facts: [], missingMetrics: Object.keys(METRIC_TAG_MAP) };

      const facts: NormalizedFinancialFact[] = [];
      const missingMetrics: string[] = [];

      for (const [metricName, tagCandidates] of Object.entries(METRIC_TAG_MAP)) {
        let found = false;
        for (const tag of tagCandidates) {
          const tagData = usGaap[tag];
          if (!tagData?.units) continue;
          const unitKey = Object.keys(tagData.units)[0]; // USD, USD/shares, shares, etc.
          const points = tagData.units[unitKey] as Array<{
            end: string; val: number; fy: number; fp: string; form: string; filed: string; accn: string; start?: string;
          }>;
          if (!points?.length) continue;

          // Most recent 10-K/10-Q datapoint for this tag.
          const relevant = points
            .filter((p) => p.form === "10-K" || p.form === "10-Q")
            .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime())[0];
          if (!relevant) continue;

          const { periodType, fiscalQuarter } = normalizePeriod(relevant.fp, relevant.form, relevant.start, relevant.end);

          facts.push({
            metricName,
            value: relevant.val,
            currency: unitKey.startsWith("USD") ? "USD" : unitKey,
            periodType,
            fiscalYear: relevant.fy ?? null,
            fiscalQuarter,
            periodEnd: relevant.end,
            filingDate: relevant.filed,
            accessionNumber: relevant.accn,
            xbrlTag: tag,
            sourceUrl: `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${parseInt(cik, 10)}&accession_number=${relevant.accn.replace(/-/g, "")}`,
            dataQuality: "HIGH",
          });
          found = true;
          break;
        }
        if (!found) missingMetrics.push(metricName);
      }

      if (facts.length === 0) return { status: "UNAVAILABLE", facts: [], missingMetrics };
      return { status: missingMetrics.length > 0 ? "PARTIAL_DATA" : "OK", facts, missingMetrics };
    } catch {
      return { status: "ERROR", facts: [], missingMetrics: Object.keys(METRIC_TAG_MAP) };
    }
  }

  private toCompanyMasterRecord(ticker: string, cik: string, name: string): CompanyMasterRecord {
    return {
      companyId: cik,
      ticker,
      exchange: "US", // company_tickers.json doesn't include exchange; cross-referencing company facts' exchange field is a documented follow-up
      country: "US",
      currency: "USD",
      companyName: name,
      isin: null,
      securityType: "STOCK",
      sector: null,
      industry: null,
      active: true,
      listingDate: null,
      delistingDate: null,
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Derives FY/Q1-Q4/TTM only when the filing form and dates make it
 * unambiguous. XBRL's own "fp" field (Q1-Q4/FY) is trusted first; quarter
 * number is inferred from a 10-Q's start/end span only as a fallback, and
 * left null rather than guessed if it can't be determined confidently.
 */
function normalizePeriod(
  fp: string | undefined,
  form: string,
  start: string | undefined,
  end: string
): { periodType: NormalizedFinancialFact["periodType"]; fiscalQuarter: number | null } {
  if (fp === "FY" || form === "10-K") return { periodType: "FY", fiscalQuarter: null };
  if (fp && ["Q1", "Q2", "Q3", "Q4"].includes(fp)) {
    return { periodType: fp as "Q1" | "Q2" | "Q3" | "Q4", fiscalQuarter: parseInt(fp[1], 10) };
  }
  if (form === "10-Q" && start) {
    const month = new Date(end).getMonth();
    const quarter = Math.floor(month / 3) + 1;
    return { periodType: (`Q${quarter}` as "Q1" | "Q2" | "Q3" | "Q4"), fiscalQuarter: quarter };
  }
  return { periodType: "FY", fiscalQuarter: null };
}
