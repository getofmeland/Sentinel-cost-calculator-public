---
name: regenerate-fixtures
description: Regenerate all test fixtures and snapshot data from current pricing configuration. Destructive — overwrites existing test data.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Regenerate Test Fixtures

This skill regenerates all test fixture data from the current pricing configuration. It overwrites existing test files, so it should only be run deliberately.

**Invocation:** `/regenerate-fixtures` — this skill will never auto-trigger.

## Steps

### 1. Read Current Pricing Config

Load all pricing data from `src/data/`:
- `pricing.ts` — commitment tiers, PAYG rates
- `logSources.ts` — log source definitions and ingestion ranges
- `defenderMapping.ts` — M365 licence to Defender coverage mapping

### 2. Generate Calculation Fixtures

Create test fixture files in `src/__fixtures__/` with pre-computed expected values:

**`payg-fixtures.json`:**
```json
[
  { "gbPerDay": 0, "monthlyUsd": 0, "monthlyGbp": 0 },
  { "gbPerDay": 1, "monthlyUsd": 158.29, "monthlyGbp": 125.05 },
  { "gbPerDay": 10, "monthlyUsd": 1582.88, "monthlyGbp": 1250.48 },
  { "gbPerDay": 50, "monthlyUsd": 7914.40, "monthlyGbp": 6252.38 },
  { "gbPerDay": 100, "monthlyUsd": 15828.80, "monthlyGbp": 12504.75 },
  { "gbPerDay": 500, "monthlyUsd": 79144.00, "monthlyGbp": 62523.76 }
]
```

**`tier-fixtures.json`:**
For each commitment tier, generate:
- Monthly cost at exactly the tier level
- Monthly cost at 50% of tier level (underage)
- Monthly cost at 150% of tier level (overage)
- Effective rate per GB
- Breakeven GB/day vs PAYG
- Savings percentage vs PAYG at tier level

**`recommendation-fixtures.json`:**
For ingestion values at 5, 10, 25, 40, 60, 70, 100, 150, 250, 400, 800, 1500, 3000 GB/day:
- Best tier name
- Monthly cost of best tier
- Monthly cost of PAYG for comparison
- Savings percentage

**`defender-overlap-fixtures.json`:**
For each licence type (E3, E5, E5 Security), with a standard set of enabled sources:
- Total ingestion before overlap
- Total ingestion after overlap
- GB/day reduction
- Monthly USD savings

### 3. Generate Snapshot Data

Create `src/__fixtures__/snapshot-inputs.json` with 5 representative customer profiles:

1. **Small E3 customer** — 200 users, basic sources, no Defender overlap
2. **Mid-market E5 customer** — 1,000 users, full Microsoft stack, Defender overlap applied
3. **Large E5 customer** — 3,000 users, all sources including network, Defender overlap
4. **E3 + heavy third-party** — 500 users, third-party firewall dominant
5. **Minimal deployment** — 100 users, only Entra ID and Activity Logs

For each profile, compute and store the expected:
- Total GB/day, billable GB/day, free GB/day
- PAYG monthly cost
- Best tier and its monthly cost
- Savings vs PAYG

### 4. Update Test Files

If test files reference hardcoded expected values, update them to match the new fixtures.

### 5. Verify

Run `npm test` after regeneration to confirm all tests still pass with the updated fixtures.

## Output

Report:
- Number of fixture files created/updated
- Any tests that failed after regeneration
- Summary of pricing values used to generate fixtures
