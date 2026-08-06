# Sentinel Cost Calculator

## Project Overview
A React-based cost calculator for Microsoft Sentinel SIEM deployments.
Target audience: UK mid-market organisations evaluating or optimising their
Sentinel spend. The user-count slider spans 100 to 50,000.

## Tech Stack
- React with TypeScript
- Tailwind CSS for styling
- Vite for build tooling
- Azure Functions (Node.js) for the feature-request API
- No backend required for calculations — all pricing logic runs client-side

## Key Features
1. Log source ingestion estimator (GB/day per source)
2. Commitment tier vs pay-as-you-go cost comparison
3. Defender XDR vs Sentinel overlap/savings analysis
4. Feature request form (floating button → Azure Functions → GitHub Issues)

## Conventions
- Use UK English in all user-facing text
- Currency displays in GBP, USD, or EUR (user-selectable)
- All pricing data lives in `src/data/` for easy updates
- Components go in `src/components/`
- Utility/calculation functions go in `src/utils/`

## Brand customisation
All brand values (colours, name, logo, default currency/region, feature request toggle) live in
`src/config/brand.ts`. See `CUSTOMISATION.md` for a full walkthrough.
Tailwind colour tokens mirror brand.ts — update both together.

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run lint` — ESLint check
- `npm test` — Run Vitest tests
