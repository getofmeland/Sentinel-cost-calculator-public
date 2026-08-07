# Sentinel Cost Calculator

A client-side cost calculator for Microsoft Sentinel SIEM deployments. Built for UK mid-market organisations evaluating or optimising their Sentinel spend, and usable from 100 up to 50,000 users.

**Live tool:** [calculator.cloudsecurityinsider.com](https://calculator.cloudsecurityinsider.com)

---

## Two modes

**Estimate** prices a deployment that does not exist yet — pick log sources, size them by user or device count, and compare commitment tiers.

**Analyse** works the other way round. You run a supplied KQL query against your own workspace, paste the results back, and it reports what you are spending and where the money could go further. Your data never leaves the browser — there is no backend to send it to.

---

## Features

| Feature | Description |
|---|---|
| **Environment profiles** | S/M/L/XL sizing profiles calibrate all source estimates within min–max ranges, with per-source overrides |
| **Ingestion estimator** | Per-source GB/day estimates scaled by user count or device count, with volume profile variants |
| **Server workload breakdown** | 14 structured server workload types (10 Windows, 4 Linux) with role-specific collection levels |
| **Table plans** | Analytics, Basic, Auxiliary/Lake and Data Lake, each priced at its own rate |
| **Live pricing by region** | Fetches current Sentinel rates from the Azure Retail Prices API for 17 Azure regions |
| **Multi-currency** | GBP, USD, and EUR, with live exchange rates and manual override |
| **Commitment tier comparison** | Breakeven analysis across all twelve commitment tiers vs PAYG |
| **Extended retention costing** | Per-source retention beyond the free window, split by tier |
| **Compliance presets** | One-click retention configuration for ISO 27001, NHS DSPT, FCA, PCI DSS 4.0 |
| **Licence benefits modelling** | M365 E5 data grant and Defender for Servers P2 free allocation |
| **Data lake compute** | Opt-in custom graph and notebook (Advanced Data Insights) meters, billed per vCore-hour |
| **Ingestion analysis** | Paste real `Usage` query results to get a ranked, costed list of savings |
| **Share and export** | Shareable links, saved state, CSV export and a print stylesheet |
| **Feature request form** | Floating button → Azure Functions → GitHub Issues |

---

## Analysing an existing workspace

Switch to **Analyse**, copy the query it shows you, and run it in your Log Analytics workspace. You need **Log Analytics Reader** (or Microsoft Sentinel Reader). Paste the results back and it will report:

- **Commitment tier fit** against your Analytics-plan volume only, since Basic and Auxiliary get no tier discount
- **Tier placement** — tables carrying investigative rather than detection value that would cost far less in the Data Lake
- **Misconfiguration** — tables being billed that Microsoft provides free
- **Questions**, for shared tables like `Syslog` and `AzureDiagnostics` where the right answer depends on what yours actually contains

Savings are applied in sequence, each measured against what the previous one leaves, so the figures do not double-count.

Three caveats the tool states on screen:

- **Set the portal time range to "Set in query".** It defaults to 24 hours and will silently override the query, giving you roughly a thirtieth of your real volume with no error.
- **Data lake usage and per-table retention cannot be measured by query.** Neither has a KQL path; check Cost management in the Defender portal for lake meters.
- **Table-level RBAC fails silently.** Queries against tables you cannot see succeed and return nothing, so a partially permissioned account produces a quietly incomplete picture.

---

## Quick start

```bash
git clone https://github.com/getofmeland/Sentinel-cost-calculator-public.git
cd Sentinel-cost-calculator-public
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## Brand customisation

Fork the repository and edit **one file**: `src/config/brand.ts`

This file contains colours, name, logo URL, website URL, default currency/region, and the feature request toggle. Everything in the UI derives from it.

See [CUSTOMISATION.md](CUSTOMISATION.md) for a full walkthrough.

After editing `brand.ts`, mirror the colour values in `tailwind.config.js` so Tailwind utility classes stay in sync.

---

## Deployment

Designed for **Azure Static Web Apps** (free tier is sufficient).

```bash
npm run build   # outputs to dist/
```

Deploy `dist/` as the static site and `api/` as the Azure Functions backend.

For the feature request form, add these application settings:
- `GITHUB_TOKEN` — personal access token with `repo` scope
- `GITHUB_OWNER` — your GitHub username or organisation
- `GITHUB_REPO` — repository name for issues

---

## Tech stack

| Layer | Technology |
|---|---|
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS |
| Build | Vite |
| Tests | Vitest |
| API | Azure Functions v4 (Node.js) |
| Hosting | Azure Static Web Apps |

No charting library — the cost vs. volume chart is a custom SVG component.

---

## Architecture

All calculations run client-side. Pricing is fetched from the Azure Retail Prices API on load; a bundled static fallback is used if the API is unreachable.

```
src/
├── config/brand.ts            # Brand config — colours, name, logo, defaults
├── data/
│   ├── pricing.ts             # THE source of truth for every rate
│   ├── logTiers.ts            # Tier definitions (imports its rates)
│   ├── tableIndex.ts          # Sentinel table → log source, for Analyse mode
│   ├── usageQuery.ts          # The KQL users run, and its documented traps
│   └── …                      # Log sources, presets, workloads, placement
├── services/
│   ├── azurePricing.ts        # Azure Retail Prices API client
│   └── fxRates.ts             # Live exchange rates
├── contexts/                  # PricingContext (region, currency, fxRate)
├── utils/                     # Pure calculation functions
│   ├── ingestion.ts           # Volume and retention
│   ├── tiers.ts               # Commitment tier maths
│   ├── compute.ts             # Graph and notebook vCore-hour meters
│   ├── usageParser.ts         # Parses pasted query results
│   └── analysis.ts            # Turns measured usage into ranked savings
└── components/
    ├── analyse/               # Analyse mode: query, paste box, report
    └── …                      # Estimate mode

api/
└── src/functions/
    ├── azure-pricing.js          # CORS proxy for pricing API
    ├── fx-rates.js               # Exchange rate proxy, 24h cache
    └── submit-feature-request.js # Feature request → GitHub Issues
```

**One rule worth knowing before changing anything:** `src/data/pricing.ts` is the only
file permitted to contain a rate literal. Everything else imports from it, and a test
fails the build if a rate reappears in a component. This exists because the rates once
drifted across seven files and shipped wrong.

---

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md).

Key points:
- UK English in all user-facing text
- No hardcoded brand colours — use Tailwind tokens or `brand.ts`
- No hardcoded rates outside `src/data/pricing.ts` — a test enforces this
- Pricing changes need a source link, ideally to the Azure Retail Prices API rather than a
  pricing page, since the API is machine-readable and regional

---

## Licence

[MIT](LICENCE) © 2026 CloudSecurityInsider

---

## Disclaimer

Pricing shown is estimated from the [Azure Retail Prices API](https://prices.azure.com) and published Microsoft rates. Figures are indicative only — actual costs depend on your negotiated rates, enterprise agreements, and Microsoft pricing changes. Always verify with your Microsoft account team or Azure portal before committing to a spend plan.
