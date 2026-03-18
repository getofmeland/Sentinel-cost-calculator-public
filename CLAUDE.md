# Sentinel Cost Calculator

## Project Overview
A React-based cost calculator for Microsoft Sentinel SIEM deployments.
Target audience: UK mid-market organisations (100–2,000 users) evaluating
or optimising their Sentinel spend.

## Tech Stack
- React with TypeScript
- Tailwind CSS for styling
- Vite for build tooling
- No backend required — all calculations run client-side

## Key Features
1. Log source ingestion estimator (GB/day per source)
2. Commitment tier vs pay-as-you-go cost comparison
3. Defender XDR vs Sentinel overlap/savings analysis

## Conventions
- Use UK English in all user-facing text
- Currency displays in both GBP and USD
- All pricing data lives in src/data/ for easy updates
- Components go in src/components/
- Utility/calculation functions go in src/utils/

## Brand — Brightsolid
- Primary colour: Solid Green #115E67
- Accent colour: Bright Yellow #F1B434
- Secondary: Teal #00A3AD, Blue #0095C8, Orange #E87722
- White: #FFFFFF
- Dark text: #1A1A2E

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run lint` — ESLint check
- `npm test` — Run Vitest tests
