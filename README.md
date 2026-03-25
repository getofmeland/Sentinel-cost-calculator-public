# Sentinel Cost Calculator

A client-side cost calculator for Microsoft Sentinel SIEM deployments. Built for UK mid-market organisations (100–2,000 users) evaluating or optimising their Sentinel spend.

**Live tool:** [calculator.cloudsecurityinsider.com](https://calculator.cloudsecurityinsider.com)

---

## Features

| Feature | Description |
|---|---|
| **Environment profiles** | S/M/L/XL sizing profiles calibrate all source estimates within min–max ranges, with per-source overrides |
| **Ingestion estimator** | Per-source GB/day estimates scaled by user count or device count, with volume profile variants |
| **Server workload breakdown** | 14 structured server workload types (10 Windows, 4 Linux) with role-specific collection levels |
| **Dual-tier pricing** | Analytics tier (full KQL, $5.20/GB) vs Data Lake tier (limited KQL, $0.15/GB) |
| **Live pricing by region** | Fetches current Sentinel rates from the Azure Retail Prices API for 18 Azure regions |
| **Multi-currency** | GBP, USD, and EUR with configurable exchange rates |
| **Commitment tier comparison** | Breakeven analysis across all seven commitment tiers vs PAYG |
| **Extended retention costing** | Per-source retention beyond the free window, split by tier |
| **Compliance presets** | One-click retention configuration for ISO 27001, NHS DSPT, FCA, PCI DSS 4.0 |
| **Licence benefits modelling** | M365 E5 data grant and Defender for Servers P2 free allocation |
| **Feature request form** | Floating button → Azure Functions → GitHub Issues |

---

## Quick start

```bash
git clone https://github.com/CloudSecurityInsider/sentinel-cost-calculator-public.git
cd sentinel-cost-calculator
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
├── config/brand.ts          # Brand config — colours, name, logo, defaults
├── data/                    # Pricing rates, log sources, presets
├── services/azurePricing.ts # Azure Retail Prices API client
├── contexts/                # PricingContext (region, currency, fxRate)
├── utils/                   # Pure calculation functions
└── components/              # React UI components

api/
└── src/functions/
    ├── azure-pricing.js          # CORS proxy for pricing API
    └── submit-feature-request.js # Feature request → GitHub Issues
```

---

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md).

Key points:
- UK English in all user-facing text
- No hardcoded brand colours — use Tailwind tokens or `brand.ts`
- Pricing changes need a source link

---

## Licence

[MIT](LICENCE) © 2026 CloudSecurityInsider

---

## Disclaimer

Pricing shown is estimated from the [Azure Retail Prices API](https://prices.azure.com) and published Microsoft rates. Figures are indicative only — actual costs depend on your negotiated rates, enterprise agreements, and Microsoft pricing changes. Always verify with your Microsoft account team or Azure portal before committing to a spend plan.
