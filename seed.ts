import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Static metadata only. NO current prices, NO fake quotes — those must
// come from a real, configured provider at runtime (see providers/).
async function main() {
  const sectors = [
    "Technology",
    "Financials",
    "Energy",
    "Healthcare",
    "Industrials",
    "Consumer Discretionary",
    "Consumer Staples",
    "Materials",
    "Utilities",
    "Real Estate",
    "Communication Services",
  ];
  for (const name of sectors) {
    await prisma.sector.upsert({ where: { name }, create: { name }, update: {} });
  }

  const techSector = await prisma.sector.findUniqueOrThrow({ where: { name: "Technology" } });

  // Demo/example assets — clearly flagged isDemoSeed=true so they're never
  // mistaken for real tradeable coverage. No price rows are created for them.
  const demoAssets: Array<{
    symbol: string;
    name: string;
    market: "US" | "BIST";
    exchange: string;
    tradingCurrency: string;
  }> = [
    { symbol: "AAPL", name: "Apple Inc.", market: "US", exchange: "NASDAQ", tradingCurrency: "USD" },
    { symbol: "MSFT", name: "Microsoft Corp.", market: "US", exchange: "NASDAQ", tradingCurrency: "USD" },
    { symbol: "THYAO", name: "Türk Hava Yolları", market: "BIST", exchange: "BIST", tradingCurrency: "TRY" },
    { symbol: "ASELS", name: "Aselsan", market: "BIST", exchange: "BIST", tradingCurrency: "TRY" },
  ];

  for (const a of demoAssets) {
    await prisma.asset.upsert({
      where: { symbol_exchange: { symbol: a.symbol, exchange: a.exchange } },
      create: {
        symbol: a.symbol,
        name: a.name,
        assetType: "STOCK",
        market: a.market,
        exchange: a.exchange,
        tradingCurrency: a.tradingCurrency,
        referenceCurrency: a.tradingCurrency,
        dataSource: "seed-metadata-only",
        isDemoSeed: true,
        sectorId: a.market === "US" ? techSector.id : null,
      },
      update: {},
    });
  }

  console.log("Seeded static metadata (sectors + demo asset shells, no prices).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
