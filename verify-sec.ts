/**
 * Run with: npx tsx scripts/verify-sec.ts
 * Requires SEC_USER_AGENT to be set in the environment (loaded from .env).
 * This talks directly to SEC — no database or Next.js server required —
 * so a failure here means "SEC connectivity/config problem", not
 * "app problem".
 */
import "dotenv/config";
import { SECEdgarProvider } from "../lib/providers/secEdgar";

const APPLE_CIK = "0000320193";

async function main() {
  const provider = new SECEdgarProvider();

  console.log("--- Step 1: SEC_USER_AGENT configuration ---");
  const ua = process.env.SEC_USER_AGENT;
  console.log("SEC_USER_AGENT =", ua ?? "(not set)");
  if (!provider.isConfigured()) {
    console.log("❌ NOT CONFIGURED — must be set and contain an '@' (a contact email), e.g.:");
    console.log('   SEC_USER_AGENT="MyInvestmentApp/1.0 (you@example.com)"');
    process.exit(1);
  }
  console.log("✅ SEC_USER_AGENT looks valid.\n");

  console.log("--- Step 2: Apple company lookup ---");
  const company = await provider.getCompany("AAPL");
  console.log("status:", company.status);
  console.log("value:", company.value);
  if (company.status !== "VALID") {
    console.log("❌ Could not find AAPL in the SEC ticker registry. See troubleshooting below.");
    process.exit(1);
  }
  console.log("✅ Apple found. CIK:", company.value?.companyId, "\n");

  console.log("--- Step 3: Apple submissions (10-K/10-Q/8-K) ---");
  const submissions = await provider.getSubmissions(APPLE_CIK, ["10-K", "10-Q", "8-K"], 10);
  console.log("status:", submissions.status);
  console.log("filings found:", submissions.filings.length);
  console.log(submissions.filings.slice(0, 3));
  if (submissions.status !== "OK" || submissions.filings.length === 0) {
    console.log("❌ No submissions retrieved. See troubleshooting below.");
    process.exit(1);
  }
  console.log("✅ Submissions retrieved.\n");

  console.log("--- Step 4: Apple Company Facts (XBRL) ---");
  const facts = await provider.getCompanyFacts(APPLE_CIK);
  console.log("status:", facts.status);
  console.log("facts retrieved:", facts.facts.length);
  console.log("missing metrics:", facts.missingMetrics);
  console.log(facts.facts.slice(0, 5));
  if (facts.status !== "OK" && facts.status !== "PARTIAL_DATA") {
    console.log("❌ Could not retrieve company facts. See troubleshooting below.");
    process.exit(1);
  }
  console.log("✅ Company facts retrieved and normalized.\n");

  console.log("ALL PROVIDER-LEVEL CHECKS PASSED.");
  console.log("Next: verify DB storage + company sync + data health via the running app (see the curl steps).");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
