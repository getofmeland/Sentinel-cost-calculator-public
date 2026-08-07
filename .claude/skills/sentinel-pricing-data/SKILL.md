---
name: sentinel-pricing-data
description: Use when working with Microsoft Sentinel pricing calculations, ingestion estimates, tier placement, retention costing, or compliance-driven retention scenarios. Loads current pricing data and calculation rules.
---

# Microsoft Sentinel Pricing Data Skill

## Where the numbers live — read these first

**`src/data/pricing.ts` is the single source of truth for every rate.** Read it at the start of any pricing task and use what it says.

This file used to carry its own copy of the whole price book. The copy drifted: it advertised rates that were roughly 25% below the real UK South figures and an extended-retention rate that was wrong by more than fivefold, and anyone who trusted it inherited those errors. So it no longer restates rates. It covers only the things the code cannot tell you.

| What you need | Where it is |
|---|---|
| PAYG rate, commitment tiers, Data Lake rates, retention rates, FX | `src/data/pricing.ts` |
| Tier definitions, free retention windows, retention options | `src/data/logTiers.ts` |
| Licence grant rates and eligibility | `src/data/licenceBenefits.ts` |
| Per-source volume ranges and free flags | `LOG_SOURCES` in `src/data/pricing.ts` |
| Server workload volumes | `src/data/serverWorkloads.ts` |
| Tier placement recommendations | `src/data/tierPlacement.ts` |
| Compliance retention presets | `src/data/compliancePresets.ts` |
| Source → Sentinel table mapping | `src/data/sentinelTables.ts` |
| Which tables support the Basic and Auxiliary/Lake plans | `src/data/tablePlanSupport.ts` — extracted verbatim from Microsoft's per-table reference pages; the verified oracle for plan eligibility |

Commitment tiers derive their effective rate and saving from the published daily cost. Never hardcode those two — read `effectiveRateUsd` and `savingsVsPayg`, or recompute them as `dailyCostUsd / gbPerDay` and `1 − effectiveRateUsd / PAYG`.

## Verifying rates against Microsoft

The rates in `pricing.ts` are UK South, verified against the Azure Retail Prices API. To re-verify:

```
https://prices.azure.com/api/retail/prices?$filter=serviceName eq 'Sentinel' and armRegionName eq 'uksouth'
```

Two traps that have already caused real bugs:

- **`contains()` is case-sensitive.** The meters are `Data lake ingestion`, `Data lake query`, `Data lake storage` — lowercase "lake". A filter for `'Data Lake'` silently returns nothing.
- **Lake ingestion is two meters.** `Data lake ingestion Data Processed` *plus* `Data processing Data Processed`. The second does not contain the phrase "Data lake", so no lake-named filter will return it. Using only the first understates ingestion roughly threefold.

Regional rates differ substantially — UK South runs roughly 1.25× the East US base — so re-verify per region rather than scaling.

Analytics extended retention is billed under `serviceName eq 'Log Analytics'` (meter `Analytics Logs Data Retention`), not under Sentinel, so it will not appear in the query above.

## Billing rules that are not in the rate table

- Commitment tiers apply only to Analytics-plan volume — never to Data Lake, Basic or Auxiliary ingestion, which are flat-rate with no discount. Size a tier against Analytics-plan volume alone; whether a given table can even move to Basic or Auxiliary/Lake is answered by `src/data/tablePlanSupport.ts`, not by assumption.
- Overage above a commitment is billed at that tier's own discounted rate, **not** at PAYG (`BILLING_RULES.overageAtTierRate`). This is the most commonly mis-modelled rule.
- Committing above actual usage is not prorated — you pay the full commitment.
- Lowering a tier is only permitted after the wait in `BILLING_RULES.downgradeWaitDays`; raising it is immediate.
- Tiers are per-workspace unless on a dedicated cluster.
- Monthly cost = daily cost × `DAYS_PER_MONTH`.
- Data Lake retention bills on the *compressed* volume; queries bill on the *uncompressed* volume scanned.
- Analytics data mirrored to the lake incurs no second ingestion charge — storage only.

### Retention is a flow-to-stock conversion

Ingesting G GB/day and holding it D extra days leaves `G × D` GB at rest, so the monthly charge is `G × D × ratePerGbMonth`. The day count and the per-month rate are not a units error — this is the intended formula.

Take the free window from `getTierDefinition(tier).freeRetentionDays` rather than assuming 90.

Note that "extended interactive retention" and "archive" are different products at very different rates. The strategy labelled *Analytics Extended Retention* keeps full KQL, so it is interactive retention. Conflating the two once understated two-year retention costs by more than fivefold.

## Licence benefits are billing credits, not volume reductions

All data is still ingested for full detection coverage. The grants reduce the Analytics GB *charged*.

```
billableAnalyticsGbPerDay = max(0, analyticsGbPerDay − e5Grant − defenderServersGrant)
```

Read the grant rates and the eligible-source sets from `src/data/licenceBenefits.ts` — both the rate and the eligibility list have been wrong in the past, so do not assume either.

**Apply each grant exactly once.** If a commitment tier is sized on the post-grant volume, do not also subtract the grant's cash value from the resulting total. That double-count understated the headline "optimised" figure by the full value of the customer's licence benefit.

## Tier placement

`src/data/tierPlacement.ts` holds the recommendation and the rationale for every source, and is wired into the default tier each source receives. Read it rather than reasoning from scratch.

The shape of the advice: real-time detection sources (identity, EDR, email) belong on Analytics; high-volume investigative sources (firewall, flow logs, DNS, general syslog) belong on Data Lake, with Summary Rules aggregating what detection genuinely needs back into Analytics.

Placement is a recommendation with a user override — some customers do run detection against DNS or firewall data.

A recommendation is only valid if the table can actually take the plan. `src/data/tablePlanSupport.ts` records, verbatim from Microsoft's reference pages, which tables support Basic and Auxiliary/Lake — check it before proposing any plan move, and treat a table absent from it as not-capable rather than guessing.

## Compliance retention

Read `src/data/compliancePresets.ts` for the current periods and their stated basis.

When quoting a regulatory requirement, be precise about scope. The five-year record-keeping rule in FCA SYSC 9.1.2R applies to the MiFID business of common platform firms; SYSC 9.1.1R sets no specific period for firms outside that scope. Overstating a retention obligation to a regulated customer is a credibility problem, not just a costing one.

## Calculation order

1. Split sources into Analytics and Data Lake using the placement defaults.
2. Sum Analytics GB/day and Data Lake GB/day separately, excluding free sources from billable totals.
3. Compute licence grants → billable Analytics GB/day.
4. Select the commitment tier, applying overage at the tier rate.
5. Apply the Data Lake ingestion rate to lake volume.
6. Add retention for both tiers, using each tier's own free window.
7. Apply the licence credit exactly once — see the warning above.
8. Present in the user's selected currency; every displayed rate must follow that selection.
9. Show the saving against an all-Analytics PAYG baseline.

## Presenting figures

These are planning estimates built on public list pricing. Real invoices differ with negotiated rates, region, and actual ingestion. Say so when presenting totals — the ranges behind them are wide.
