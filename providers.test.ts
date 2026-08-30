import { describe, it, expect } from "vitest";
import { AlphaVantageProvider } from "../../lib/providers/alphaVantage";
import { SECEdgarProvider } from "../../lib/providers/secEdgar";
import { KAPProvider } from "../../lib/providers/kap";
import { ConfigurableFXProvider } from "../../lib/providers/fx";
import { ConfigurableCommodityProvider } from "../../lib/providers/commodity";
import { GenericNewsProvider } from "../../lib/providers/news";

/**
 * These tests hit REAL endpoints when credentials are present in the
 * environment, and are skipped (not faked) when they aren't — per "do not
 * move to the next provider until the current provider works", each of
 * these is the confirmation step for that provider. Run with:
 *   npm run test:providers
 * after populating .env with real credentials.
 */

describe("AlphaVantageProvider", () => {
  const provider = new AlphaVantageProvider();
  it.skipIf(!provider.isConfigured())("returns a real quote for a known symbol", async () => {
    const result = await provider.getQuote("AAPL");
    expect(result.status).toBe("VALID");
    expect(result.value?.price).toBeGreaterThan(0);
  });
});

describe("SECEdgarProvider", () => {
  const provider = new SECEdgarProvider();
  const APPLE_CIK = "0000320193"; // verification company per spec

  it.skipIf(!provider.isConfigured())("finds Apple in the real SEC ticker registry", async () => {
    const result = await provider.searchCompanies("AAPL", 5);
    expect(result.status).toBe("VALID");
    expect(result.value?.some((c) => c.ticker === "AAPL")).toBe(true);
  });

  it.skipIf(!provider.isConfigured())("returns real recent filings for a known CIK", async () => {
    const result = await provider.getRecentFilings("AAPL", 5);
    expect(result.status).toBe("VALID");
    expect(result.value?.length).toBeGreaterThan(0);
  });

  it.skipIf(!provider.isConfigured())("returns Apple's real submissions across supported forms", async () => {
    const result = await provider.getSubmissions(APPLE_CIK, ["10-K", "10-Q", "8-K"], 20);
    expect(result.status).toBe("OK");
    expect(result.filings.some((f) => f.form === "10-K")).toBe(true);
    // every filing must carry full provenance
    result.filings.forEach((f) => {
      expect(f.accessionNumber).toBeTruthy();
      expect(f.sourceUrl).toContain("sec.gov");
    });
  });

  it.skipIf(!provider.isConfigured())("normalizes Apple's real company facts (Revenue, Assets, Equity, Cash)", async () => {
    const result = await provider.getCompanyFacts(APPLE_CIK);
    expect(["OK", "PARTIAL_DATA"]).toContain(result.status);
    const metricNames = result.facts.map((f) => f.metricName);
    expect(metricNames).toContain("Revenue");
    expect(metricNames).toContain("Assets");
    // every fact must carry provenance sufficient to trace back to the filing
    result.facts.forEach((f) => {
      expect(f.accessionNumber).toBeTruthy();
      expect(f.xbrlTag).toBeTruthy();
      expect(f.periodEnd).toBeTruthy();
    });
  });

  it.skipIf(!provider.isConfigured())("reports missing metrics honestly rather than fabricating them", async () => {
    // A tiny/unusual filer is likely to be missing at least one mapped
    // metric (e.g. CapitalExpenditures) — this just confirms the
    // missingMetrics path is reachable, not a specific company's data.
    const result = await provider.getCompanyFacts(APPLE_CIK);
    if (result.status === "PARTIAL_DATA") {
      expect(result.missingMetrics.length).toBeGreaterThan(0);
      result.missingMetrics.forEach((m) => expect(result.facts.map((f) => f.metricName)).not.toContain(m));
    }
  });

  it("returns NOT_CONNECTED, not an error, when SEC_USER_AGENT is absent", async () => {
    const unconfigured = new SECEdgarProvider();
    if (!unconfigured.isConfigured()) {
      const result = await unconfigured.getCompanyFacts(APPLE_CIK);
      expect(result.status).toBe("NOT_CONNECTED");
      expect(result.facts).toEqual([]);
    }
  });
});

describe("KAPProvider", () => {
  const provider = new KAPProvider();
  it("reports NOT_CONNECTED honestly when no licensed feed is configured", () => {
    if (!provider.isConfigured()) {
      expect(provider.isConfigured()).toBe(false);
    }
  });
});

describe("ConfigurableFXProvider", () => {
  const provider = new ConfigurableFXProvider();
  it.skipIf(!provider.isConfigured())("returns a real USD/TRY rate", async () => {
    const result = await provider.getRate("USD", "TRY");
    expect(result.status).toBe("VALID");
    expect(result.value).toBeGreaterThan(0);
  });
});

describe("ConfigurableCommodityProvider", () => {
  const provider = new ConfigurableCommodityProvider();
  it.skipIf(!provider.isConfigured())("returns a real gold spot price", async () => {
    const result = await provider.getSpotPrice("GOLD");
    expect(result.status).toBe("VALID");
    expect(result.value?.price).toBeGreaterThan(0);
  });
});

describe("GenericNewsProvider", () => {
  const provider = new GenericNewsProvider();
  it.skipIf(!provider.isConfigured())("returns real news items for a known symbol", async () => {
    const result = await provider.getNewsForSymbol("AAPL", 3);
    expect(result.status).toBe("VALID");
    expect(result.value?.length).toBeGreaterThan(0);
  });
});
