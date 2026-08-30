import { fetchWithRetry } from "../net/httpClient";
import { RegulatoryFilingsProvider, SourcedValue, unavailable } from "./types";

/**
 * Turkey's primary disclosure source (KAP — Kamuyu Aydınlatma Platformu)
 * does not publish a standard, documented public REST API the way SEC
 * EDGAR does. This provider is intentionally honest about that: without a
 * licensed data feed configured at KAP_PROVIDER_URL, it reports
 * NOT_CONNECTED rather than scraping the public site (the spec explicitly
 * says not to assume scraping is production-acceptable) or fabricating
 * disclosure data.
 */
export class KAPProvider implements RegulatoryFilingsProvider {
  readonly name = "KAPProvider";

  isConfigured(): boolean {
    return !!process.env.KAP_PROVIDER_URL;
  }

  async getRecentFilings(identifier: string, limit = 10): Promise<SourcedValue<Array<{ filingType: string; filedAt: string; url: string }>>> {
    if (!this.isConfigured()) {
      return { ...unavailable(this.name), status: "UNAVAILABLE" };
    }
    try {
      const url = `${process.env.KAP_PROVIDER_URL}?symbol=${encodeURIComponent(identifier)}&limit=${limit}`;
      const result = await fetchWithRetry(url);
      if (result.status !== "OK") return { value: null, status: "ERROR", source: this.name, retrievedAt: new Date().toISOString() };
      const json = await result.response.json();
      if (!Array.isArray(json)) return { value: null, status: "UNAVAILABLE", source: this.name, retrievedAt: new Date().toISOString() };
      return {
        value: json.map((d: { formType: string; date: string; url: string }) => ({ filingType: d.formType, filedAt: d.date, url: d.url })),
        status: "VALID",
        source: "KAP",
        retrievedAt: new Date().toISOString(),
      };
    } catch {
      return { value: null, status: "ERROR", source: this.name, retrievedAt: new Date().toISOString() };
    }
  }
}
