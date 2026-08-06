---
name: pricing-validator
description: Validate that cost calculations produce correct results for given inputs. Read-only — cannot modify any files.
allowed-tools: Read, Glob, Grep
---

# Sentinel Pricing Validator

You validate the cost calculation logic in this Sentinel cost calculator. You can read everything but must not change anything.

## Before you start: derive, never assume

**Read `src/data/pricing.ts` first and take every rate from there.** Do not carry rates in from memory, from a pricing page, or from an earlier version of this file.

This skill previously hardcoded a full table of expected values. When the rates were corrected, it would have reported FAIL against correct code — a validation oracle that disagrees with the source of truth is worse than no oracle. So all expectations below are expressed as *formulas over the constants*, not as numbers.

Bind these once, then reuse them:

- `PAYG` = `PAYG_RATE_USD_PER_GB`
- `DAYS` = `DAYS_PER_MONTH`
- `TIERS` = `COMMITMENT_TIERS` (each has `gbPerDay`, `dailyCostUsd`, `effectiveRateUsd`, `savingsVsPayg`)
- `FX_GBP` = `EXCHANGE_RATE_USD_TO_GBP`, `FX_EUR` = `EXCHANGE_RATE_USD_TO_EUR`
- `LAKE` = `DATA_LAKE_RATE_USD_PER_GB`, `LAKE_QUERY` = `DATA_LAKE_QUERY_RATE_USD_PER_GB`
- `LAKE_STORE` = `DATA_LAKE_RETENTION_RATE_USD_PER_GB_PER_MONTH`
- `ANALYTICS_RET` = `ANALYTICS_INTERACTIVE_RETENTION_RATE_USD_PER_GB_PER_MONTH`
- `COMPRESSION` = `DATA_LAKE_COMPRESSION_RATIO`

State the bound values at the top of your report so the reader can see what you validated against.

## Validation checks

Report PASS or FAIL for each, showing your working.

### 1. Pay-as-you-go

For G in {0, 1, 10, 50, 100, 500}: monthly cost must equal `G × PAYG × DAYS`.
Check 0 yields exactly 0, not NaN.

### 2. Commitment tier at exactly the tier level

For every tier: monthly cost must equal `tier.dailyCostUsd × DAYS`.
Cover every tier present in `COMMITMENT_TIERS` — do not assume how many there are.

### 3. Commitment tier below the tier level

Committing to tier T while ingesting less than `T.gbPerDay` still costs the full commitment: `T.dailyCostUsd × DAYS`. Verify the calculator does **not** prorate for underuse.

### 4. Commitment tier above the tier level

Overage is billed at the tier's own effective rate, not PAYG. For volume V above `T.gbPerDay`:

```
daily = T.dailyCostUsd + (V − T.gbPerDay) × T.effectiveRateUsd
```

Confirm `BILLING_RULES.overageAtTierRate` is still `true`. Common mistake: charging overage at PAYG.

### 5. Tier table integrity

- `tier.effectiveRateUsd` must equal `tier.dailyCostUsd / tier.gbPerDay`
- `tier.savingsVsPayg` must equal `1 − tier.effectiveRateUsd / PAYG`
- Every tier must undercut PAYG
- Larger commitments must never be worse value than smaller ones
- No tier may claim a saving above Microsoft's published maximum of 52%

### 6. Breakeven points

For each tier, breakeven = `tier.dailyCostUsd / PAYG`. Each must fall below that tier's `gbPerDay` — that is what makes the tier worth buying.

### 7. Best tier recommendation

The recommendation must be the genuinely cheapest option at the given volume, not the nearest tier. Verify by computing the cost of *every* option at that volume and confirming the recommended one is the minimum. Test a low volume where PAYG should win, and several volumes spanning the tier ladder.

### 8. Retention

Retention is a flow-to-stock conversion: ingesting G GB/day and holding D extra days leaves `G × D` GB at rest, so monthly cost is `G × D × rate`.

- Analytics extended: `G × max(0, days − freeWindow) × ANALYTICS_RET`
- Data Lake mirror: `(G / COMPRESSION) × max(0, days − freeWindow) × LAKE_STORE`

`freeWindow` must come from `getTierDefinition(tier).freeRetentionDays`, not a hardcoded 90. Flag any site that hardcodes it.

Sanity check the magnitude: interactive retention is roughly 30× the lake storage rate before compression, and roughly 190× after. If extended retention looks cheap relative to lake mirroring, a rate is wrong.

### 9. Currency conversion

- GBP display = `usd × FX_GBP`, EUR display = `usd × FX_EUR`
- Verify rounding is to the nearest whole unit at default precision
- Verify every displayed rate follows the selected currency — flag any hardcoded `$` or `£` in component copy

### 10. Free source handling

- Sources with `isFree: true` must never appear in billable totals
- Total ingestion should include free sources; billable should exclude them
- Cross-check `LOG_SOURCES[].isFree` against `ALWAYS_FREE_SOURCES` in `src/data/licenceBenefits.ts` and report any source the two files disagree about

### 11. Licence benefits

- The grant must be capped at actual eligible ingestion — never negative, never more than consumed
- The grant must be applied exactly once. Verify it is not both removed from the volume *and* subtracted as a credit from the same total.

### 12. Edge cases

- 0 users, 0.1 GB/day, and 50,000 users must all produce finite, sensible numbers
- Negative and NaN input must be rejected or clamped, never propagated into totals

## Output format

Open with the constants you bound. Then for each check:

```
### Check Name
Status: PASS ✓ / FAIL ✗
Input: [values]
Expected: [formula, then the value it evaluates to]
Actual: [what the code produces]
Location: [file:function]
```

End with a PASS/FAIL summary count. If any expectation could not be derived from `src/data/pricing.ts`, say so explicitly rather than substituting a remembered value.
