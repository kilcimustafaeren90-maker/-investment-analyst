import { fetchWithRetry } from "../net/httpClient";
import { withCache, CACHE_TTL_MS } from "../cache/dataCache";
import { NewsProvider, NewsItem, SourcedValue, unavailable } from "./types";

/**
 * Trusted news is the LAST priority source per the spec's ordering — used
 * as secondary context, never as a substitute for a primary filing. Points
 * at NEWS_API_KEY / a NewsAPI-compatible endpoint by default; swap by
 * implementing NewsProvider again, same as every other provider here.
 */
export class GenericNewsProvider implements NewsProvider {
  readonly name = "GenericNewsProvider";

  isConfigured(): boolean {
    return !!process.env.NEWS_API_KEY;
  }

  async getNewsForSymbol(symbol: string, limit = 10): Promise<SourcedValue<NewsItem[]>> {
    if (!this.isConfigured()) return unavailable(this.name);
    try {
      const cacheKey = `news:${symbol}:${limit}`;
      const items = await withCache(cacheKey, CACHE_TTL_MS.NEWS, async () => {
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(symbol)}&pageSize=${limit}&sortBy=publishedAt&apiKey=${process.env.NEWS_API_KEY}`;
        const result = await fetchWithRetry(url);
        if (result.status !== "OK") return null;
        const json = await result.response.json();
        if (!Array.isArray(json.articles)) return null;
        return json.articles.map((a: { title: string; url: string; source: { name: string }; publishedAt: string; description?: string }) => ({
          headline: a.title,
          url: a.url,
          source: a.source?.name ?? "Unknown",
          publishedAt: a.publishedAt,
          summary: a.description,
        })) as NewsItem[];
      });

      if (!items) return { ...unavailable<NewsItem[]>(this.name), status: "ERROR" };
      return { value: items, status: "VALID", source: this.name, retrievedAt: new Date().toISOString() };
    } catch {
      return { ...unavailable<NewsItem[]>(this.name), status: "ERROR" };
    }
  }
}
