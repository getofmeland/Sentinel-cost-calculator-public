# Sentinel Cost Calculator

## Project Overview
A React-based cost calculator for Microsoft Sentinel SIEM deployments.
Target audience: UK mid-market organisations evaluating or optimising their
Sentinel spend. The user-count slider spans 100 to 50,000, split into two
segments — SMB/Mid-market (100–5,000) and Enterprise (5,000–50,000) — because a
single track put the core audience inside its first tenth. The segment is
DERIVED from the user count in `src/data/segments.ts` and never stored beside
it; two figures that can disagree is the shape of every serious bug here.

The estimator opens on `MXDR_DEFAULT_SOURCE_IDS`: the Microsoft telemetry a
managed detection service actually runs on. Network and third-party sources are
excluded because they vary by estate and assuming them inflates every
first-visit estimate.

Two modes share one pricing engine:
- **Estimate** — price a deployment that does not exist yet
- **Analyse** — paste real `Usage` query results and get ranked, costed savings

## Tech Stack
- React with TypeScript
- Tailwind CSS for styling
- Vite for build tooling
- Azure Functions (Node.js) for the pricing proxy, FX rates and feature-request API
- No backend required for calculations — all pricing logic runs client-side.
  Pasted workspace data never leaves the browser, and that is a feature worth
  protecting: the audience will not paste log data into a website that phones home.

## Rules that exist because something went wrong

**`src/data/pricing.ts` is the only file allowed to contain a rate literal.**
Rates once drifted across seven files and shipped wrong. `logTiers.ts` imports
its rates; components read them from `PricingContext`. A test in
`src/utils/__tests__/consistency.test.ts` fails the build if a rate reappears in
a component, and another asserts documentation matches code.

**Verify rates against the Azure Retail Prices API, not a pricing page.**

```
https://prices.azure.com/api/retail/prices?$filter=serviceName eq 'Sentinel' and armRegionName eq 'uksouth'
```

Microsoft's own documentation has contradicted itself more than once — `/1000`
versus `/1024` for MB→GB, and "compute hour" versus "vCore hour". Where prose and
a worked example disagree, trust the worked example. Regional rates differ
substantially (UK South is roughly 1.25x East US), so never scale between regions.

**Commitment tiers apply only to Analytics-plan volume.** Basic and Auxiliary are
flat-rate with no discount. Sizing a tier against total billable volume is wrong.

**Graph and Advanced Data Insights bill per vCore-hour, not per pool-hour.**
A graph build runs on 49 vCores, so it costs 49x the hourly rate. Both meters are
opt-in and default off — enabling the data lake does not bill them.

**Table plan support is looked up, never assumed.** `src/data/tablePlanSupport.ts`
holds Basic and Auxiliary/Lake support extracted verbatim from each table's
generated reference page, and `tableCatalogue.test.ts` fails the build if a
catalogue entry disagrees with it. A release once told users to move sixteen
operational tables — `Perf`, `ContainerLogV2`, the Application Insights set — to
the Lake tier. None of them support it. The refusal logic was already correct;
the `lakeCapable` values fed to it were guessed from "this table is big and
boring", which is not evidence. A table Microsoft does not document must be
marked not-capable: unverified is not the same as supported.

Beware two lookalike columns. The Sentinel connectors reference publishes
"Lake-only ingestion supported", which is about how a connector ingests, not
which plans a table plan supports. The two disagree in practice, so that column
is deliberately not imported.

**Do not sum savings that are not independent.** Two bugs of this shape have
already shipped: a licence grant credited against a tier already sized net of it,
and Analyse-mode opportunities summed against pre-move volume. Apply them in
sequence, each measured against what the previous leaves.

**Prefer under-claiming.** Where the tool cannot tell — an ambiguous shared table,
an unmappable custom table, a collection method it does not model — say so and
exclude it rather than guessing. Confidently wrong savings advice is worse than
none.

## Conventions
- UK English in all user-facing text
- Currency displays in GBP, USD, or EUR (user-selectable); the retail API returns USD
- Pricing data in `src/data/`, calculations in `src/utils/`, UI in `src/components/`
- Accessibility: `text-light/40` and below fail WCAG AA on these backgrounds — use
  `/60` or higher for anything conveying information. The brand purple and pink both
  fail as small text; `primary-text` and `accent-text` are the compliant tints.

## Brand customisation
All brand values (colours, name, logo, default currency/region, feature request toggle) live in
`src/config/brand.ts`. See `CUSTOMISATION.md` for a full walkthrough.
Tailwind colour tokens mirror brand.ts — update both together.

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build (runs typecheck first)
- `npm run lint` — ESLint check
- `npm run typecheck` — Type check both projects. Note: plain `tsc --noEmit` against
  the root tsconfig checks **nothing**, because it is a solution file with no files
  of its own. Always use this script.
- `npm run test:run` — Run Vitest once

CI gates deploys on all four. Check exit codes rather than piping to `tail`, which
masks them.
