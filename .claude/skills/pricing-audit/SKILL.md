---
name: pricing-audit
description: Audit all pricing data in the project against Microsoft's published rates. Runs in isolation to avoid cluttering the main conversation.
context: fork
agent: Explore
---

# Sentinel Pricing Audit

You are auditing a Microsoft Sentinel cost calculator for pricing accuracy. This tool is used in customer-facing presales meetings, so every number must be defensible.

## Task

1. **Scan all data files** in `src/data/` and any component files that contain hardcoded pricing values
2. **List every pricing value** you find:
   - Pay-as-you-go rate per GB
   - Each commitment tier daily cost and effective per-GB rate
   - Savings percentages
   - Breakeven points
   - Free source definitions
   - Log source ingestion estimates (GB/day ranges)
   - Exchange rate defaults
3. **Cross-reference values** against each other for internal consistency:
   - Does the effective $/GB equal daily cost ÷ tier GB?
   - Do savings percentages match the actual difference between PAYG and tier rates?
   - Are breakeven calculations correct (tier daily cost ÷ PAYG rate)?
   - Do monthly costs use 30.44 days consistently?
4. **Flag any concerns**:
   - Values that look inconsistent with each other
   - Hardcoded prices in component files that should reference the data layer
   - Missing tiers or log sources
   - Any value that seems unrealistic (e.g., ingestion estimate outside normal ranges)

## Output Format

```
## Pricing Audit Summary
- Files scanned: [count]
- Values checked: [count]
- Issues found: [count]

## Issues
1. [CRITICAL/WARNING/INFO] — description, file:line, current value, expected value

## All Pricing Values Found
| Value | Location | Current | Notes |
|---|---|---|---|
```

Be thorough. Check every file, not just the obvious ones.
