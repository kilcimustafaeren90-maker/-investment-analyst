import { FXProvider, GoldDataProvider, SourcedValue, unavailable } from "./types";

// Exchange-rate provider abstraction. Wire to any real FX vendor (e.g.
// exchangerate.host, Open Exchange Rates, TCMB EVDS for TRY) by setting
// FX_API_KEY / FX_API_URL — nothing else in the app needs to change.
export class ConfigurableFXProvider implements FXProvider {
  readonly name = "FXProvider";

  isConfigured(): boolean {
    return !!process.env.FX_API_URL;
  }

  async getRate(base: string, quote: string): Promise<SourcedValue<number>> {
    if (base === quote) {
      return {
        value: 1,
        status: "VALID",
        source: "identity",
        retrievedAt: new Date().toISOString(),
      };
    }
    if (!this.isConfigured()) return unavailable(this.name);
    try {
      const url = `${process.env.FX_API_URL}?base=${base}&symbols=${quote}`;
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (!res.ok) return { ...unavailable<number>(this.name), status: "ERROR" };
      const json = await res.json();
      const rate = json?.rates?.[quote];
      if (typeof rate !== "number") return unavailable(this.name);
      return {
        value: rate,
        status: "VALID",
        source: this.name,
        retrievedAt: new Date().toISOString(),
      };
    } catch {
      return { ...unavailable<number>(this.name), status: "ERROR" };
    }
  }
}

// Gold spot price provider. Wire to a licensed bullion/commodities feed via
// GOLD_API_URL + GOLD_API_KEY.
export class ConfigurableGoldProvider implements GoldDataProvider {
  readonly name = "GoldProvider";

  isConfigured(): boolean {
    return !!process.env.GOLD_API_URL;
  }

  async getSpotPriceUSDPerOunce(): Promise<SourcedValue<number>> {
    if (!this.isConfigured()) return unavailable(this.name);
    try {
      const res = await fetch(process.env.GOLD_API_URL as string, {
        headers: process.env.GOLD_API_KEY
          ? { "x-access-token": process.env.GOLD_API_KEY }
          : undefined,
        next: { revalidate: 300 },
      });
      if (!res.ok) return { ...unavailable<number>(this.name), status: "ERROR" };
      const json = await res.json();
      const price = json?.price;
      if (typeof price !== "number") return unavailable(this.name);
      return {
        value: price,
        status: "VALID",
        source: this.name,
        retrievedAt: new Date().toISOString(),
        currency: "USD",
      };
    } catch {
      return { ...unavailable<number>(this.name), status: "ERROR" };
    }
  }
}

const TROY_OUNCE_TO_GRAM = 31.1034768;

export function convertGoldUnit(
  pricePerOunce: number,
  unit: "ounce" | "gram" | "kilogram"
): number {
  if (unit === "ounce") return pricePerOunce;
  if (unit === "gram") return pricePerOunce / TROY_OUNCE_TO_GRAM;
  return (pricePerOunce / TROY_OUNCE_TO_GRAM) * 1000;
}
