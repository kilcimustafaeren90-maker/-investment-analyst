 # AI Investment Analyst — V1

## Setup
```
cp .env.example .env      # fill in DATABASE_URL at minimum; add API keys as you get them
npm install
npx prisma migrate dev --name init
npx tsx prisma/seed.ts
npm run dev
```

## Cloud deployment (no local machine required)
This app is designed to deploy on **Vercel + Neon** entirely through web dashboards
(GitHub web upload → Vercel import → Neon Postgres). `vercel.json`'s build
command runs `prisma migrate deploy` only on production builds (checked via
Vercel's own `VERCEL_ENV`), so preview deployments never touch the schema and
migrations never require a local terminal. See the deployment plan for the
full step-by-step.

### Vercel Cron (prepared, not yet active)
No `crons` entry exists in `vercel.json` yet — none of the scheduled-job
routes (daily briefing, catalyst sync, etc.) are wired to run automatically.
To activate later: add a `crons` array to `vercel.json` pointing at a route,
and guard that route by checking a `CRON_SECRET` header so it can't be
triggered by anyone who finds the URL. Not implemented yet, by design.


## Status without API keys
Every page runs and every endpoint responds — with an honest
`DATA_SOURCE_NOT_CONFIGURED` / "Data source not configured" state instead of
fake numbers, per the no-fabrication rule. Add `MARKET_DATA_API_KEY` to light
up `/api/stock/[symbol]`; add `AI_API_KEY` to light up AI scenario synthesis.

## Adding a new market-data provider
Implement `MarketDataProvider` in `lib/providers/`, then swap the instance
created in `app/api/stock/[symbol]/route.ts`. Nothing else changes.
