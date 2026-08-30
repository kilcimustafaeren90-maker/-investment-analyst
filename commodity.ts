import { fetchWithRetry } from "../net/httpClient";
import { CommodityDataProvider, NormalizedDataPoint, notConnected } from "./types";

const COMMODITY_ENV_URL: Record<string, string | undefined> = {
  GOLD: process.env.GOLD_API_URL,
  SILVER: process.env.SILVER_API_URL,
  OIL_BRENT: process.env.OIL_API_URL,
};

const UNIT: Record<string, string> = { GOLD: "troy_ounce", SILVER: "troy_ounce", OIL_BRENT: "barrel" };

export class ConfigurableCommodityProvider implements CommodityDataProvider {
  readonly name = "ConfigurableCommodityProvider";

  isConfigured(): boolean {
    return !!process.env.GOLD_API_URL; // gold is the V1-required commodity; others are additive
  }

  async getSpotPrice(commodity: "GOLD" | "SILVER" | "OIL_BRENT"): Promise<NormalizedDataPoint<{ price: number; unit: string }>> {
    const url = COMMODITY_ENV_URL[commodity];
    if (!url) return notConnected(this.name, "LICENSED_MARKET_DATA");
    try {
      const result = await fetchWithRetry(url, process.env.GOLD_API_KEY ? { headers: { "x-access-token": process.env.GOLD_API_KEY } } : {});
      if (result.status !== "OK") return { ...notConnected(this.name, "LICENSED_MARKET_DATA"), status: "ERROR" };
      const json = await result.response.json();
      if (typeof json.price !== "number") return notConnected(this.name, "LICENSED_MARKET_DATA");
      return {
        value: { price: json.price, unit: UNIT[commodity] },
        currency: "USD",
        source: this.name,
        sourceType: "LICENSED_MARKET_DATA",
        sourceUrl: null,
        retrievedAt: new Date().toISOString(),
        period: null,
        dataTimestamp: json.timestamp ?? null,
        dataQuality: "HIGH",
        confidence: 90,
        provider: this.name,
        status: "VALID",
      };
    } catch {
      return { ...notConnected(this.name, "LICENSED_MARKET_DATA"), status: "ERROR" };
    }
  }
}
