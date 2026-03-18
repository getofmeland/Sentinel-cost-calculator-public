# Sentinel Cost Calculator

A client-side React application for estimating and optimising Microsoft Sentinel SIEM deployment costs. Built for UK mid-market organisations (100–2,000 users) evaluating or right-sizing their Sentinel spend, and used internally by the MXDR scoping team.

Pricing is fetched live from the [Azure Retail Prices API](https://prices.azure.com/api/retail/prices) for any of 18 supported regions, with graceful fallback to static defaults. All cost calculations run client-side.

**Live app:** https://witty-bush-0526b2403.azurestaticapps.net

---

## Features

| Feature | Description |
|---|---|
| **Environment profile** | Global S/M/L/XL sizing profiles calibrate all source estimates within their min–max ranges, with per-source overrides |
| **Ingestion estimator** | Per-source GB/day estimates scaled by user count or device count, with volume profile variants (e.g. O365 workload scope) |
| **Server workload breakdown** | 14 structured server workload types (10 Windows, 4 Linux) with role-specific collection levels (Minimal/Common/All Events and Standard/Verbose) |
| **Dual-tier pricing** | Analytics tier (full KQL, $5.20/GB) vs Data Lake tier (limited KQL, $0.15/GB) with opinionated default placement per source |
| **Live pricing by region** | Fetches current Sentinel rates from the Azure Retail Prices API for any of 18 Azure regions; cached 24 hours per region with fallback to static defaults |
| **Configurable FX rate** | GBP/USD conversion rate adjustable in the header; all GBP values update immediately |
| **Commitment tier comparison** | Breakeven analysis across all seven Microsoft commitment tiers (50–5,000 GB/day) vs PAYG, with dynamic axis scaling and interactive controls |
| **Extended retention costing** | Per-source retention beyond the free window, split by tier; Analytics up to 2 years, Data Lake up to 12 years |
| **Compliance preset selector** | One-click retention configuration for ISO 27001, NHS DSPT/NCSC CAF, FCA Regulated, FCA MiFID II, and PCI DSS 4.0 |
| **Licence benefits modelling** | Models E5 data grant (5 MB/user/day for Entra ID + MDCA) and Defender for Servers P2 free allocation (500 MB/server/day for Windows workloads) as billing credits |
| **Table reference popovers** | Clickable info icon on every source shows which Log Analytics / Advanced Hunting tables the connector populates, with links to Microsoft Learn and a copyable KQL example |
| **Cost summary** | Monthly cost breakdown combining all optimisations, displayed in both GBP and USD |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 with TypeScript |
| Build tool | Vite 5 |
| Styling | Tailwind CSS 3 (custom Brightsolid brand theme) |
| Testing | Vitest |
| Linting | ESLint with `@typescript-eslint` (zero warnings policy) |
| Deployment | Azure Static Web Apps (CI via GitHub Actions) |

No charting library — the cost vs. volume chart is a custom SVG component.
No routing, no state management library — all state lives in `IngestionEstimator`.

---

## Getting Started

```bash
npm install
npm run dev       # Start dev server at http://localhost:5173
npm run build     # Production build → dist/
npm run lint      # ESLint (zero warnings)
npm test          # Vitest unit tests
```

---

## Architecture Overview

The application is intentionally flat — no routing, no global state library, no API layer. All state lives in a single top-level component (`IngestionEstimator`) and flows down through props.

```
src/
├── data/                       # Static data — pricing rates, log sources, presets
│   ├── pricing.ts              # PAYG rate, commitment tiers, Data Lake rates, log source catalogue
│   ├── logTiers.ts             # Analytics / Data Lake tier definitions (rates, retention options)
│   ├── tierPlacement.ts        # Default tier per log source (analytics/data-lake/free)
│   ├── tshirtSizes.ts          # S/M/L/XL environment profile definitions and interpolation helpers
│   ├── serverWorkloads.ts      # 14 structured server workload types (Windows + Linux)
│   ├── licenceBenefits.ts      # M365 licence definitions, E5 grant constants, P2 grant constant
│   ├── compliancePresets.ts    # Compliance framework presets (ISO 27001, FCA, NHS, PCI DSS)
│   └── sentinelTables.ts       # Sentinel table reference data — tables per source + KQL examples
│
├── services/
│   └── azurePricing.ts         # Azure Retail Prices API client — fetch, parse, 24h cache, fallback
│
├── contexts/
│   └── PricingContext.tsx      # React context — region, fxRate, live PricingBundle
│
├── utils/                      # Pure calculation functions (no React)
│   ├── ingestion.ts            # Core ingestion estimate + IngestionSummary aggregation
│   ├── serverWorkloads.ts      # computeServerWorkloadRows() — server workload GB/day calculation
│   ├── licenceBenefits.ts      # computeLicenceBenefits() — E5 grant + Defender P2 credits
│   ├── tiers.ts                # Commitment tier option computation + breakeven logic
│   ├── retention.ts            # Human-readable retention label formatting
│   └── currency.ts             # GBP/USD formatting helpers
│
└── components/                 # React UI components
    ├── IngestionEstimator.tsx  # Root component — all state, all handlers
    ├── RegionSelector.tsx      # Region dropdown + FX rate input + live pricing status
    ├── SourceRow.tsx           # Single log source row (checkbox, controls, t-shirt size, retention)
    ├── ServerWorkloads.tsx     # Server workload breakdown (counts, collection levels, size controls)
    ├── TableInfoPopover.tsx    # Clickable info icon + table reference popover
    ├── CompliancePresetBanner.tsx  # Compliance framework preset selector
    ├── RetentionStrategyPanel.tsx  # Per-source retention strategy selector (Analytics extended vs mirror)
    ├── IngestionSummaryBar.tsx # Summary cards (total GB, tier split, retention costs)
    ├── TierPlacementTab.tsx    # Tier placement review and override UI
    ├── LicenceBenefits.tsx     # E5 data grant + Defender for Servers P2 benefit modelling
    ├── TierComparison.tsx      # Commitment tier vs PAYG comparison table
    ├── TierTable.tsx           # Tabular tier option display
    ├── BreakevenChart.tsx      # Custom SVG breakeven chart with dynamic axis scaling
    ├── CostSummary.tsx         # Final monthly cost summary
    ├── StickyTotalBar.tsx      # Persistent bottom bar showing three cost scenarios
    ├── TabNav.tsx              # Tab navigation component
    └── App.tsx / main.tsx      # Entry point

api/
└── src/functions/
    └── azure-pricing.js        # Azure Functions v4 proxy — server-side fetch bypasses CORS
```

### Data flow

```
data/pricing.ts + logTiers.ts + serverWorkloads.ts + tshirtSizes.ts
                    │
                    ▼
        IngestionEstimator   ←── user interactions
        (all state lives here)
                    │
    ┌───────────────┼───────────────────────────────┐
    │               │                               │
    ▼               ▼                               ▼
computeServer   summariseIngestion()     computeLicenceBenefits()
WorkloadRows()  ──► IngestionSummary     ──► LicenceBenefitResult
    │                │                               │
    └───────► allRows merged here                    │
                     │                               │
                     ├─► computeTierOptions()  ──► TierOption[]
                     │
                     └─► derived totals ──► StickyTotalBar
```

### State owned by `IngestionEstimator`

| State | Type | Description |
|---|---|---|
| `selectedIds` | `Set<string>` | Which log sources are active |
| `userCount` | `number` | Slider value (100–2,000, step 50) |
| `deviceCounts` | `Record<string, number>` | Per-source device/instance count |
| `logTiers` | `Record<string, LogTierKey>` | Per-source tier assignment (analytics / data-lake) |
| `retentionDays` | `Record<string, number>` | Per-source selected retention in days |
| `retentionStrategies` | `Record<string, RetentionStrategy>` | Per-source retention strategy (analytics-extended / data-lake-mirror) |
| `selectedVariants` | `Record<string, string>` | Per-source volume profile variant (e.g. O365 workload scope) |
| `manualGbValues` | `Record<string, number>` | Manual GB/day overrides (custom application logs) |
| `globalSize` | `TshirtSize` | Active environment profile (S/M/L/XL) — default M |
| `sourceSizeOverrides` | `Record<string, TshirtSize>` | Per-source size overrides; cleared when global profile changes |
| `serverCounts` | `Record<string, number>` | Per-workload server count |
| `serverLevels` | `Record<string, string>` | Per-workload collection level (e.g. 'common', 'standard') |
| `serverSizeOverrides` | `Record<string, TshirtSize>` | Per-workload size overrides |
| `activePresetId` | `CompliancePresetId` | Active compliance framework preset |
| `licence` | `M365Licence` | Selected M365 licence tier (none / e3 / e5 / e5-security) |
| `defenderEnabled` | `boolean` | Defender for Servers P2 credit enabled |

`totalEnrolledServers` is derived — it is the sum of all server workload counts and feeds into `computeLicenceBenefits` automatically. There is no manual enrolled-server input.

---

## Live Pricing

The app fetches current Sentinel rates from the [Azure Retail Prices API](https://prices.azure.com/api/retail/prices) on page load and whenever the region changes.

```
Browser → /api/azure-pricing (Azure Functions proxy)
                    ↓
         prices.azure.com/api/retail/prices
```

`prices.azure.com` does not return `Access-Control-Allow-Origin` headers, so the Azure Functions proxy in `api/src/functions/azure-pricing.js` handles the fetch server-side. In local development, the Vite dev-server proxy at `/azure-pricing` serves the same role — see `vite.config.ts`.

Three parallel queries are issued per region — PAYG rate, commitment tiers, and Data Lake rate. Retention rates come from static values in `src/data/pricing.ts` (Azure Monitor pricing uses a different API filter and is not fetched live).

Results are cached in-memory per region for 24 hours. On any failure the app falls back silently to the static UK South rates and shows **"Using cached rates"** in the header. The manual refresh button (↻) clears the cache entry and re-fetches.

**Supported regions:** UK South, UK West, North Europe, West Europe, France Central, Germany West Central, Sweden Central, Switzerland North, Norway East, East US, East US 2, West US 2, Central US, Southeast Asia, Australia East, UAE North, South Africa North.

---

## Pricing Data

All static rates are in `src/data/` and intentionally separated from calculation logic so they can be updated without touching component code.

**Current static rates (UK South, March 2026)**

| Item | Rate |
|---|---|
| Analytics PAYG | $5.20 / GB ingested |
| Data Lake ingestion | $0.15 / GB ingested |
| Analytics extended retention | $0.023 / GB / month |
| Data Lake long-term retention | $0.02 / GB / month (6:1 compression applied) |
| Default FX rate | $1 = £0.79 |

**Commitment tiers (Analytics only)**

| Tier | Effective rate | Saving vs PAYG |
|---|---|---|
| 50 GB/day *(preview promo, until March 2027)* | $3.80/GB | 27% |
| 100 GB/day | $3.35/GB | 36% |
| 200 GB/day | $3.15/GB | 39% |
| 500 GB/day | $2.92/GB | 44% |
| 1,000 GB/day | $2.70/GB | 48% |
| 2,000 GB/day | $2.54/GB | 51% |
| 5,000 GB/day | $2.43/GB | 53% |

**To update static fallback pricing:** edit `src/data/pricing.ts` and `src/data/logTiers.ts`, and update the date comment on line 1. No other files need to change. Live pricing from the Azure API reflects Microsoft's current rates automatically.

---

## Environment Profile (T-Shirt Sizing)

Ingestion volume varies 3–4× between a minimal-policy environment and a verbose/compliance-driven one. The **Environment Profile** selector applies a global position multiplier to all source estimates within their calibrated min–max ranges.

| Profile | Label | Multiplier | Typical environment |
|---|---|---|---|
| S | Light | 0.30 | Minimal audit policies, low user activity, basic monitoring |
| M | Standard | 0.50 | Default audit policies, moderate activity *(default)* |
| L | Active | 0.75 | Enhanced audit policies, financial services, legal, healthcare |
| XL | Verbose | 0.95 | Maximum audit logging, FCA-regulated, PCI scope, high-security |

The multiplier feeds into `interpolateRange(min, max, multiplier)` defined in `src/data/tshirtSizes.ts`. M (0.50) produces the same result as the old `(min + max) / 2` midpoint formula, ensuring backwards compatibility at the default profile.

Individual sources and server workloads can have independent size overrides — shown with a **Custom** badge. Changing the global profile clears all per-source overrides.

When a compliance preset (FCA, PCI DSS) is active and the global profile is S or M, an inline suggestion banner prompts switching to L or XL.

---

## Log Source Catalogue

19 configurable log sources across 7 groups, plus 14 structured server workloads (separate section).

### Estimation methodology

> **Important:** The GB/day ranges in `LOG_SOURCES` (`src/data/pricing.ts`) are **calibrated estimates, not Microsoft-published figures**. Microsoft does not publish a canonical per-source ingestion rate. The ranges were set based on general knowledge of Sentinel table sizes, community-reported real-world volumes, and Microsoft's Advanced Hunting table documentation where available. Volumes should be validated against **Azure Monitor → Workspace → Ingestion** once live.

Volume is computed as:

```
estimateSourceGbPerDay(source, userCount, deviceCount, variantId, manualGbValue, sizeMultiplier)
```

Where `sizeMultiplier` is taken from the active environment profile (or a per-source override). The function applies the multiplier via `interpolateRange(range[0], range[1], sizeMultiplier)`.

### Source groups

| Group | Sources |
|---|---|
| Identity & Entra | Entra ID Sign-in & Audit, Entra ID Protection |
| Microsoft Defender | MDE, MDI, MDO, MDCA, Defender for Cloud |
| Microsoft 365 | O365/M365 Audit Logs *(workload variants: Exchange / Exchange+SharePoint / All)*, Intune |
| Azure Platform | Azure Activity Logs *(free)*, Key Vault |
| Network | Azure Firewall, NSG Flow Logs, WAF, DNS Logs, Third-party Firewall, VPN/ZTNA |
| Third-party & Custom | Email Gateway, Custom Application Logs *(manual GB/day input)* |
| Infrastructure | Replaced by structured Server Workloads (see below) |

### Source ranges (at M profile / 0.50 multiplier)

| Source | Scale | Range (min–max) | M profile estimate |
|---|---|---|---|
| Entra ID Sign-in & Audit | per 1k users | 0.5–3.0 GB | 1.75 GB |
| Entra ID Protection | per 1k users | 0.1–0.5 GB | 0.30 GB |
| Microsoft Defender for Endpoint | per 1k users | 2.0–10.0 GB | 6.00 GB |
| Microsoft Defender for Identity | per 1k users | 0.3–2.0 GB | 1.15 GB |
| Microsoft Defender for Office 365 | per 1k users | 0.3–1.5 GB | 0.90 GB |
| Microsoft Defender for Cloud Apps | per 1k users | 0.3–2.5 GB | 1.40 GB |
| Microsoft Defender for Cloud | per VM | 0.2–1.5 GB | 0.85 GB |
| Office 365 Audit — Exchange only | per 1k users | 0.05–0.3 GB | 0.18 GB |
| Office 365 Audit — Exchange + SharePoint | per 1k users | 0.1–0.6 GB | 0.35 GB |
| Office 365 Audit — All workloads | per 1k users | 0.1–1.0 GB | 0.55 GB |
| Microsoft Intune | per 1k users | 0.1–0.5 GB | 0.30 GB |
| Azure Activity Logs *(free)* | per 1k users | 0.05–0.5 GB | 0.28 GB |
| Azure Key Vault | per vault | 0.05–0.3 GB | 0.18 GB |
| Azure Firewall | per firewall | 3.0–40.0 GB | 21.50 GB |
| NSG Flow Logs | per VNET/NSG | 5.0–50.0 GB | 27.50 GB |
| Web Application Firewall | per instance | 0.5–5.0 GB | 2.75 GB |
| DNS Logs | per DNS server | 0.5–8.0 GB | 4.25 GB |
| Third-party Firewall | per device | 1.0–20.0 GB | 10.50 GB |
| VPN / Zero Trust | per 1k users | 0.3–1.5 GB | 0.90 GB |
| Email Gateway | per 1k users | 0.5–2.0 GB | 1.25 GB |
| Custom Application Logs | manual input | — | user-entered |

Sources with `isFree: true` (Azure Activity Logs) incur no Sentinel ingestion charge and are excluded from commitment tier calculations.

---

## Server Workloads

Server volume varies significantly by role and audit policy level. The **Server Workloads** section (within the Ingestion tab) replaces the old single-slider Windows/Linux source with 14 structured workload types configured independently.

### Windows server workloads (SecurityEvent table)

All Windows workloads send to the `SecurityEvent` table via the **Windows Security Events via AMA** connector. All are eligible for the Defender for Servers P2 500 MB/server/day free allocation (`p2Eligible: true`).

| Workload | ID | Collection levels | Ranges (min–max, GB/server/day) |
|---|---|---|---|
| Domain Controller | `ws-dc` | Minimal / Common / All Events | 0.3–0.7 / 1.5–2.5 / 6.0–10.0 |
| File Server | `ws-fileserver` | Minimal / Common / All Events | 0.07–0.15 / 0.35–0.65 / 2.0–4.0 |
| SQL / Database | `ws-sql` | Minimal / Common / All Events | 0.07–0.15 / 0.3–0.5 / 1.5–2.5 |
| Web / IIS Server | `ws-web` | Minimal / Common / All Events | 0.07–0.15 / 0.2–0.4 / 1.0–2.0 |
| Application Server | `ws-app` | Minimal / Common / All Events | 0.07–0.15 / 0.2–0.4 / 1.0–2.0 |
| RDS / Terminal Server | `ws-rds` | Minimal / Common / All Events | 0.1–0.3 / 0.75–1.25 / 3.0–5.0 |
| Member Server | `ws-member` | Minimal / Common / All Events | 0.03–0.07 / 0.15–0.25 / 0.75–1.25 |
| DHCP Server *(advanced)* | `ws-dhcp` | Minimal / Common / All Events | 0.03–0.07 / 0.15–0.25 / 0.35–0.65 |
| Print Server *(advanced)* | `ws-print` | Minimal / Common / All Events | 0.01–0.03 / 0.07–0.13 / 0.2–0.4 |
| Exchange (on-premises) *(advanced)* | `ws-exchange` | Minimal / Common / All Events | 0.2–0.4 / 1.0–2.0 / 4.0–6.0 |

DHCP, Print Server, and Exchange are hidden in a collapsible "Advanced workloads" panel. Default collection level for all Windows workloads is **Common**.

When **All Events** is selected, an inline note appears suggesting a DCR to route Common events to Analytics and verbose events to Data Lake.

### Linux server workloads (Syslog table)

Linux workloads send to the `Syslog` table via the **Syslog via AMA** connector. Linux workloads are **not** eligible for the Defender for Servers P2 grant (`p2Eligible: false`).

| Workload | ID | Collection levels | Ranges (min–max, GB/server/day) |
|---|---|---|---|
| Linux Web Server | `lx-web` | Standard / Verbose | 0.2–0.4 / 1.5–2.5 |
| Linux App Server | `lx-app` | Standard / Verbose | 0.07–0.15 / 0.75–1.25 |
| Linux Database | `lx-db` | Standard / Verbose | 0.07–0.15 / 0.6–1.0 |
| Linux General Server | `lx-general` | Standard / Verbose | 0.03–0.07 / 0.35–0.65 |

Default collection level for all Linux workloads is **Standard**.

### Server workload calculation

`computeServerWorkloadRows()` in `src/utils/serverWorkloads.ts`:

```
gbPerDay = interpolateRange(level.min, level.max, getSizeMultiplier(size)) × count
```

Server workload rows are passed as `additionalRows` into `summariseIngestion()`, where they are merged with regular source rows before all aggregations.

---

## Tier Placement

Default tier assignments are defined in `src/data/tierPlacement.ts` and applied when a source is first enabled. Users can override any source on the **Tier Placement** tab.

**Analytics** — sources requiring real-time KQL detection rules, alert correlation, or low-latency incident response.

**Data Lake** — high-volume sources queried only during investigations, or where Summary Rules can aggregate data into Analytics for alerting.

| Default: Analytics | Default: Data Lake |
|---|---|
| Entra ID, Entra ID Protection | Azure Firewall |
| MDE, MDI, MDO, MDCA, MDC | NSG Flow Logs |
| O365 Audit, Intune, Key Vault | DNS Logs |
| All Windows server workloads | Third-party Firewall, WAF |
| Most Linux workloads | Email Gateway, VPN/ZTNA |
| | Custom Application Logs |
| | Linux General Server |

Azure Activity Logs are marked as `free` — they incur no ingestion cost and do not appear in the tier placement tab.

---

## Retention Model

Free retention windows per tier:

| Tier | Included retention |
|---|---|
| Analytics | 90 days |
| Data Lake | 30 days |

Extended retention is charged per GB of data held per month beyond the free window.

**Analytics sources** support two extended retention strategies selectable per source:

| Strategy | Rate | Max | Notes |
|---|---|---|---|
| Analytics Extended | $0.023/GB/month | 730 days (2 years) | Full KQL performance |
| Mirror to Data Lake | $0.02/GB/month × 1/6 compression | 4,380 days (12 years) | Slower queries; ~85% cheaper |

**Data Lake sources** always use native Data Lake retention (30-day free window, then $0.02/GB/month with 6:1 compression). The Data Lake mirror retention options start at 90 days to align with the Analytics hot window.

Retention costs are split into three lines in `IngestionSummary`:
- `analyticsExtendedRetentionMonthlyCostUsd` — Analytics sources using extended retention
- `dataLakeMirrorRetentionMonthlyCostUsd` — Analytics sources mirrored to Data Lake
- `dataLakeNativeRetentionMonthlyCostUsd` — native Data Lake tier sources

---

## Compliance Presets

The **Compliance preset** selector (Ingestion tab) applies retention periods to all active sources in one click, respecting the per-tier maximum.

| Preset | Analytics retention | Data Lake retention | Basis |
|---|---|---|---|
| ISO 27001 | 365 days | 365 days | 12-month industry best practice |
| NHS DSPT / NCSC CAF | 365 days | 365 days | "Sufficient period" — 12 months recommended |
| FCA Regulated (General) | 730 days *(capped)* | 1,825 days (5 yr) | FCA SYSC 9.1 — 5 years |
| FCA MiFID II | 730 days *(capped)* | 1,825 days (5 yr) | MiFID II Article 25 — 5 years minimum |
| FCA MiFID II + extension | 730 days *(capped)* | 2,555 days (7 yr) | MiFID II Article 25 extended at FCA request |
| PCI DSS 4.0 | 90 days *(free window)* | 365 days | Req 10.5.1 — 90d hot, 12 months total |

When a preset requires retention that exceeds the Analytics tier maximum (730 days), a warning banner prompts migration of those sources to Data Lake via the Tier Placement tab.

Manually adjusting any source's retention after applying a preset reverts the selector to **Custom**.

---

## Licence Benefits

The **Optimisation** tab models two types of Microsoft billing credit that reduce the Analytics GB/day that is billed — they do not reduce ingestion volume.

### M365 E5 Data Grant

Users with M365 E5 or E5 Security receive **5 MB/user/day** of free Sentinel Analytics ingestion, applied to Entra ID and Defender for Cloud Apps sources only.

```
e5AllowanceGbPerDay = userCount × 0.005
e5GrantGbPerDay     = min(e5AllowanceGbPerDay, e5EligibleAnalyticsGbPerDay)
```

Eligible sources: `entra-id`, `mdca` (defined in `E5_GRANT_ELIGIBLE_SOURCE_IDS`).
Qualifying licences: E5, E5 Security (defined in `E5_QUALIFYING_LICENCES`).

### Defender for Servers Plan 2

Each server enrolled in Defender for Servers P2 receives **500 MB/server/day** of free Sentinel Analytics ingestion, applied only to **Windows Security Events** (`p2Eligible: true` on the source). Linux Syslog is not eligible.

```
defenderServersAllowanceGbPerDay = totalEnrolledServers × 0.5
defenderServersGrantGbPerDay     = min(allowance, windowsSecurityEventsAnalyticsGbPerDay)
```

`totalEnrolledServers` is auto-derived from the Server Workloads section (sum of all Windows + Linux server counts). There is no manual enrolled-server input — the two values are always consistent.

### Billable Analytics after credits

```
billableAnalyticsGbPerDay = max(0, analyticsGbPerDay − e5GrantGbPerDay − defenderServersGrantGbPerDay)
```

This reduced figure is used for commitment tier calculations and the breakeven chart.

---

## Cost vs. Volume Chart

The breakeven chart (`src/components/BreakevenChart.tsx`) is a custom SVG component — no charting library.

**Dynamic axis scaling** — the x-axis upper limit is computed from the customer's current volume:
```
nextTier = first commitment tier above billableGbPerDay
xMax     = max(75, min(5000, nextTier.gbPerDay × 1.5))
```
The axis limits update with a 200ms debounce to avoid jitter while the user adjusts sliders. The customer position marker (dashed vertical line) updates immediately.

**Smart y-axis ticks** — the y-axis auto-selects a tick interval that gives 4–8 ticks across the visible cost range, chosen from candidates `[5, 10, 20, 50, 100, 200, 500, 1000, …]`.

**Controls:**
- GBP / USD currency toggle (default GBP, uses live fxRate)
- "Show full range" toggle — overrides x-axis to 0–5,000 GB/day
- Per-tier checkboxes — hide individual commitment tier lines; best tier marked with ★
- SVG hover crosshair tooltip — shows cost at cursor for PAYG and all visible tiers

---

## Table Reference Popovers

Every log source and server workload has a small teal circled-i icon (ℹ) next to its name. Clicking it opens a popover showing:

- **Connector name** as it appears in Sentinel Content Hub
- **Tables populated** — table name (links to Microsoft Learn), one-line description; collapsed at 4 with expandable overflow
- **KQL example** — copyable query with a clipboard button
- **Contextual note** — volume guidance relevant to that source
- **Connector docs link**

The popover is portal-rendered (`document.body`) for correct z-index handling, positions itself anchored to the info button, flips above the button when near the bottom of the viewport, and closes on outside click or Escape.

Table data lives in `src/data/sentinelTables.ts`. All 19 regular log sources and both server workload groups (Windows / Linux) have mappings. `resolveWorkloadMappingId()` maps any `ws-*` ID to `ws-security` and any `lx-*` to `lx-syslog` so all workload variants share the same table data.

---

## Brand Colours (Brightsolid)

Defined as custom Tailwind tokens in `tailwind.config.js`:

| Token | Hex | Usage |
|---|---|---|
| `primary` → `solid-green` | `#115E67` | Interactive accents, selected states, tier lines |
| `accent` → `bright-yellow` | `#F1B434` | Best commitment tier, cost highlights |
| `teal` | `#00A3AD` | Table reference icons, info note panels |
| `bright-blue` | `#0095C8` | Data Lake tier indicators |
| `orange` | `#E87722` | Analytics tier indicators |
| `dark` | `#1A1A2E` | Page background, dark surfaces |

---

## Updating the Calculator

### Add a new log source

1. Add an entry to `LOG_SOURCES` in `src/data/pricing.ts`
2. Add a tier default in `src/data/tierPlacement.ts`
3. Add a table reference mapping in `src/data/sentinelTables.ts`

### Add a server workload type

1. Add a `ServerWorkload` entry to `SERVER_WORKLOADS` in `src/data/serverWorkloads.ts`
2. Add a tier placement entry in `src/data/tierPlacement.ts`
3. Add a table reference mapping in `src/data/sentinelTables.ts` (or use the shared `ws-security` / `lx-syslog` key)

### Add a new commitment tier

Add to `COMMITMENT_TIERS` in `src/data/pricing.ts`. The tier comparison table and breakeven chart update automatically.

### Add a compliance preset

Add to `COMPLIANCE_PRESETS` in `src/data/compliancePresets.ts` following the existing interface. The preset dropdown populates from this array.

### Update a pricing rate

Edit the relevant constant in `src/data/pricing.ts` or `src/data/logTiers.ts`. Update the date comment on line 1 of `pricing.ts`. Live pricing fetched from the Azure API reflects Microsoft's current rates automatically — no code change needed for live regions.

### Update an ingestion range

Update the `gbPer1000UsersRange` or `gbPerDeviceRange` on the relevant entry in `LOG_SOURCES`. For server workloads, update the `gbPerServerPerDay` ranges on the relevant `CollectionLevel` in `src/data/serverWorkloads.ts`.

### Add E5 data grant eligibility to a new source

Add the source ID to `E5_GRANT_ELIGIBLE_SOURCE_IDS` in `src/data/licenceBenefits.ts`.

### Mark a Windows server workload as Defender P2 eligible

Set `p2Eligible: true` on the `ServerWorkload` entry in `src/data/serverWorkloads.ts`. The `computeLicenceBenefits` function uses `r.source.p2Eligible === true` — no other change is needed.

---

## Tests

Unit tests in `src/utils/__tests__/calculations.test.ts` (Vitest) cover:

- `estimateSourceGbPerDay` — user-scaled and device-scaled sources, manual override, variant selection, t-shirt size multipliers
- `interpolateRange` / `getSizeMultiplier` — S/M/L/XL multiplier values; M matches old midpoint formula
- `computeServerWorkloadRows` — DC at 5 servers M size, zero count, L > M, p2Eligible flags, collection levels
- `summariseIngestion` — GB/day totals, tier splits, retention cost calculation (all three strategies), additionalRows merging
- `computeLicenceBenefits` — E5 grant capped at allowance; Defender grant applied to Windows-only (p2Eligible) rows; Linux sources not eligible; combined credits
- `computeTierOptions` — recommended tier selection, savings percentages

```bash
npm test          # Run all tests
npm test -- --run # Single run (no watch mode)
```
