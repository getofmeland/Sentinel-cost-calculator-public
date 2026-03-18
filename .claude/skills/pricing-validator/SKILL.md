---
name: pricing-validator
description: Validate that cost calculations produce correct results for given inputs. Read-only — cannot modify any files.
allowed-tools: Read, Glob, Grep
---

# Sentinel Pricing Validator

You validate the cost calculation logic in this Sentinel cost calculator. You can read everything but must not change anything.

## Validation Checks

Run through each of these scenarios and report PASS or FAIL with your working.

### 1. Pay-As-You-Go Calculations

| Input (GB/day) | Expected Monthly (USD) | Formula |
|---|---|---|
| 0 | $0 | 0 × $5.20 × 30.44 |
| 1 | $158 | 1 × $5.20 × 30.44 |
| 10 | $1,583 | 10 × $5.20 × 30.44 |
| 50 | $7,914 | 50 × $5.20 × 30.44 |
| 100 | $15,829 | 100 × $5.20 × 30.44 |
| 500 | $79,144 | 500 × $5.20 × 30.44 |

### 2. Commitment Tier — At Exactly the Tier Level

For each tier, if ingestion equals exactly the tier GB/day, the monthly cost should be:
- `tier.dailyUsd × 30.44`

Verify this for all tiers (50, 100, 200, 500, 1000, 2000, 5000).

### 3. Commitment Tier — Below the Tier Level

If a customer commits to 100 GB/day but only ingests 60 GB/day, they still pay the full 100 GB/day commitment:
- Monthly cost = 335 × 30.44 = $10,197

Verify the calculator handles this correctly (does NOT prorate for underuse).

### 4. Commitment Tier — Above the Tier Level

If a customer commits to 100 GB/day but ingests 150 GB/day:
- Overage (50 GB) is billed at the SAME effective rate, not PAYG
- Effective rate = $335 ÷ 100 = $3.35/GB
- Monthly cost = 150 × $3.35 × 30.44 = $15,296

Verify this. Common mistake: charging overage at PAYG rate.

### 5. Breakeven Points

For each tier, the breakeven GB/day where it becomes cheaper than PAYG:
- Formula: tier.dailyUsd ÷ PAYG_RATE
- 50 GB tier: $190 ÷ $5.20 = 36.5 GB/day
- 100 GB tier: $335 ÷ $5.20 = 64.4 GB/day
- 200 GB tier: $630 ÷ $5.20 = 121.2 GB/day

Verify the calculator computes and displays these correctly.

### 6. Best Tier Recommendation

| Ingestion (GB/day) | Expected Recommendation |
|---|---|
| 5 | Pay-As-You-Go |
| 40 | 50 GB tier (if cheaper than PAYG) |
| 70 | 100 GB tier |
| 150 | 200 GB tier |
| 400 | 500 GB tier |

Verify the recommendation logic picks the cheapest option, not just the closest tier.

### 7. Currency Conversion

- Default FX rate: 0.79
- $10,000/mo should display as £7,900/mo
- Verify rounding is to the nearest whole pound/dollar

### 8. Free Source Handling

- Azure Activity Logs should never appear in billable totals
- Office 365 Audit Logs are marked "partial" — verify they are handled correctly
- Total ingestion should include free sources; billable should exclude them

### 9. Edge Cases

- 0 users: should not produce NaN or Infinity
- 0.1 GB/day: should calculate correctly
- 50,000 users: numbers should remain sensible
- Negative input: should be rejected or clamped

## Output Format

For each check:
```
### Check Name
Status: PASS ✓ / FAIL ✗
Input: [values]
Expected: [value]
Actual: [what the code produces]
Formula: [working]
Location: [file:function if relevant]
```

End with a summary count of PASS/FAIL.
