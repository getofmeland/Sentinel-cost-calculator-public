---
name: sentinel-pricing-data
description: Use when working with Microsoft Sentinel pricing calculations, ingestion estimates, tier placement, retention costing, or compliance-driven retention scenarios. Loads current pricing data and calculation rules.
---

# Microsoft Sentinel Pricing Data Skill

## Current Pricing (UK South, Simplified Tiers, as of March 2026)

### Analytics Tier — Pay-As-You-Go
- Approximately $5.20 per GB ingested (combined Log Analytics + Sentinel)
- Default 90-day interactive retention included at no extra charge
- Extended retention beyond 90 days up to 2 years: ~$0.023/GB/month (Azure Monitor archive rate)

### Analytics Tier — Commitment Tiers

| Tier (GB/day) | Approx. Daily Cost (USD) | Effective $/GB | Savings vs PAYG |
|---|---|---|---|
| 50 (preview promo) | ~$190 | ~$3.80 | ~27% |
| 100 | ~$335 | ~$3.35 | ~36% |
| 200 | ~$630 | ~$3.15 | ~39% |
| 500 | ~$1,460 | ~$2.92 | ~44% |
| 1,000 | ~$2,700 | ~$2.70 | ~48% |
| 2,000 | ~$5,080 | ~$2.54 | ~51% |
| 5,000 | ~$12,150 | ~$2.43 | ~53% |

### Data Lake Tier (formerly Auxiliary Logs)
- Ingestion: $0.15/GB (combined $0.05 data lake ingestion + $0.10 data processing)
- Long-term retention: $0.02/GB/month (billed on compressed volume)
- Compression ratio: 6:1 (600 GB raw ≈ 100 GB billed)
- Query cost: $0.005/GB of data scanned (uncompressed)
- Maximum retention: 12 years
- Interactive query window: 30 days
- GA since 30 September 2025

### Key Billing Rules
- Commitment tiers apply to Analytics tier only, not Data Lake
- Overage above commitment is billed at the SAME discounted tier rate, NOT PAYG
- Downgrade requires 31-day wait; upgrades are immediate
- Tiers are per-workspace unless on a dedicated cluster
- Monthly cost = daily cost × 30.44 (average days per month)
- Data Lake compression is automatic — billing on compressed size for retention
- Data Lake queries are billed on uncompressed (raw) size

### Free Data Sources (no Sentinel ingestion charge)
- Azure Activity Logs
- Office 365 Audit Logs (partial — management activity is free)
- Microsoft Defender XDR incident data (via unified connector)

### Licence Benefits (Billing Credits)
All data is ingested into Sentinel for full detection coverage. Licence benefits create **billing credits** that reduce the Analytics GB charged — they do NOT reduce ingestion volume.

#### M365 E5 Data Grant
- Qualifying licences: M365 E5, M365 E3 + E5 Security
- Rate: 5 MB (0.005 GB) per user per day
- **Eligible sources only**: Entra ID Sign-in & Audit, Microsoft Defender for Cloud Apps (MDCA)
- Credit = min(userCount × 0.005, eligible Analytics GB/day)
- MDE, MDI, MDO, and other sources do NOT qualify for the E5 data grant

#### Defender for Servers Plan 2
- Rate: 500 MB (0.5 GB) per enrolled server per day
- Eligible sources: Windows Security Events, Linux Syslog (Analytics tier only)
- Credit = min(enrolledServers × 0.5, Windows + Linux Analytics GB/day)
- Requires Azure Monitor Agent with Defender for Servers P2 active

#### Always-Free Sources (no billing regardless of licence)
- Azure Activity Logs — modelled in the estimator
- O365 Management Activity — management audit records
- Defender XDR / MDE / MDI / MDO / MDCA alert metadata — alert tables are free; raw telemetry is billable
- Defender for Cloud alerts — security alert records

#### Billable Analytics GB/day
`billableAnalyticsGbPerDay = max(0, analyticsGbPerDay - e5GrantGbPerDay - defenderServersGrantGbPerDay)`
Commitment tier selection and tier comparison must use the **billable** (post-credit) GB/day, not total analytics GB/day.

## Log Source Tier Placement Recommendations

### Analytics Tier (Primary — Real-Time Detection)

| Log Source | GB/day per 1,000 users | Reason |
|---|---|---|
| Entra ID Sign-in & Audit | 0.5 – 2.0 | Identity-based detection, impossible travel, brute force |
| Defender for Endpoint (MDE) | 2.0 – 8.0 | Core EDR telemetry for incident detection |
| Defender for Identity (MDI) | 0.5 – 2.0 | Lateral movement, credential attacks |
| Defender for Office 365 (MDO) | 0.5 – 1.5 | Phishing, BEC, malicious attachment detection |
| Defender for Cloud Apps (MDCA) | 0.5 – 2.0 | Shadow IT, OAuth app abuse |
| Windows Security Events (Common) | 1.0 – 3.0 | Logon events, process creation — use Common not All Events |
| Office 365 Audit Logs | 0.2 – 1.0 | Management activity for insider threat detection |

### Data Lake Tier (Secondary — Investigation & Forensics)

| Log Source | GB/day per 1,000 users | Reason |
|---|---|---|
| Azure Firewall / NSG Flow Logs | 5.0 – 30.0 | High volume, queried during network investigations only |
| DNS Logs | 1.0 – 5.0 | C2 detection via summary rules, bulk forensic queries |
| Third-party Firewall | 2.0 – 15.0 | Investigation context, same as Azure Firewall |
| Linux Syslog | 0.5 – 3.0 | Unless Linux-heavy with active detection rules |
| Custom Application Logs | 0.5 – 5.0 | Compliance/audit, rarely queried real-time |

### Free (Tier Irrelevant)
- Azure Activity Logs: 0.1 – 0.5 GB/day per 1,000 users — always free

### Tier Placement Notes
- Windows Security Events "All Events" can push 5+ GB/day. Recommend Common for Analytics, verbose to Data Lake via DCR.
- Tier placement is a recommendation with override. Some customers run detection rules against DNS/firewall.
- Summary Rules aggregate Data Lake into Analytics for specific detections (IOC matching etc).

## Compliance Retention Presets

### ISO 27001 Standard
- Analytics: 90 days | Data Lake: 1 year
- Basis: A.8.15 requires logs retained and reviewed. 12 months industry standard for audit cycle.

### NHS DSPT / CAF-Aligned
- Analytics: 90 days | Data Lake: 2 years
- Basis: CAF demands monitoring/logging evidence. 2 years covers DSPT audit cycle + historical.

### FCA Regulated (General)
- Analytics: 90 days | Data Lake: 3 years
- Basis: SYSC 9.1 orderly records. 3 years from case closure for incident/breach logs.

### FCA MiFID II
- Analytics: 180 days | Data Lake: 5 years (7 if FCA requests)
- Basis: MiFID records min 5 years. Communications 5-7 years.

### PCI DSS 4.0
- Analytics: 90 days | Data Lake: 1 year
- Basis: Req 10.7 — 12 months history, 3 months immediately available.

## Calculation Instructions

1. Separate sources into Analytics and Data Lake using placement recommendations
2. Sum Analytics GB/day total (all Analytics-tier sources)
3. Compute licence benefits (E5 grant + Defender for Servers) → billable Analytics GB/day
4. Apply commitment tier pricing to **billable** Analytics GB/day (not total)
5. Sum Data Lake GB/day — apply $0.15/GB flat rate
6. Calculate retention: Analytics extended ($0.023/GB/month beyond 90 days) + Data Lake ($0.02/GB/month compressed)
7. Total monthly = Analytics ingestion + Data Lake ingestion + retention costs
8. Savings = (e5GrantGbPerDay + defenderServersGrantGbPerDay) × DAYS_PER_MONTH × paygRateUsd
9. Show USD and GBP (default FX 0.79)
10. Show savings vs all-Analytics PAYG baseline
