// Microsoft Licence Benefit definitions for Sentinel billing credits
// These benefits reduce billable Analytics GB/day — they do NOT reduce ingestion volume.

export type M365Licence = 'none' | 'e3' | 'e5' | 'e5-security' | 'e7' | 'a5' | 'f5' | 'g5'

export interface LicenceDefinition {
  id: M365Licence
  label: string
  shortLabel: string
  description: string
  includes: string[]
}

export const LICENCES: LicenceDefinition[] = [
  {
    id: 'none',
    label: 'None / M365 E1',
    shortLabel: 'None',
    description: 'No licence benefits',
    includes: [],
  },
  {
    id: 'e3',
    label: 'Microsoft 365 E3',
    shortLabel: 'E3',
    description: 'Limited benefits only',
    includes: ['Defender for Office 365 P1'],
  },
  {
    id: 'e5',
    label: 'Microsoft 365 E5',
    shortLabel: 'E5',
    description: 'Full benefit suite — recommended',
    includes: [
      'Defender for Endpoint P2',
      'Defender for Identity',
      'Defender for Office 365 P2',
      'Defender for Cloud Apps',
      'Entra ID P2',
    ],
  },
  {
    id: 'e5-security',
    label: 'M365 E3 + E5 Security',
    shortLabel: 'E5 Security',
    description: 'Identical benefits to E5',
    includes: [
      'Defender for Endpoint P2',
      'Defender for Identity',
      'Defender for Office 365 P2',
      'Defender for Cloud Apps',
      'Entra ID P2',
    ],
  },
  {
    id: 'e7',
    label: 'Microsoft 365 E7',
    shortLabel: 'E7',
    description: 'Same 5 MB Sentinel data grant as E5',
    includes: ['5 MB/user/day Microsoft 365 data grant'],
  },
  {
    id: 'a5',
    label: 'Microsoft 365 A5',
    shortLabel: 'A5',
    description: 'Same 5 MB Sentinel data grant as E5',
    includes: ['5 MB/user/day Microsoft 365 data grant'],
  },
  {
    id: 'f5',
    label: 'Microsoft 365 F5 Security',
    shortLabel: 'F5 Security',
    description: 'Security add-on — same 5 MB data grant',
    includes: ['5 MB/user/day Microsoft 365 data grant'],
  },
  {
    id: 'g5',
    label: 'Microsoft 365 G5',
    shortLabel: 'G5',
    description: 'Same 5 MB Sentinel data grant as E5',
    includes: ['5 MB/user/day Microsoft 365 data grant'],
  },
]

// ─── E5 Data Grant ────────────────────────────────────────────────────────────

/**
 * Each qualifying Microsoft 365 E7, E5, A5, F5, G5 or E5 Security user
 * includes 5 MB/day of free Sentinel Analytics ingestion for the eligible
 * sources listed below.
 */
export const E5_DATA_GRANT_GB_PER_USER_PER_DAY = 0.005

/**
 * Source IDs whose Analytics-tier ingestion is eligible for the E5 data grant.
 *
 * Microsoft's offer covers four categories: Entra ID sign-in and audit logs,
 * Defender for Cloud Apps Shadow IT discovery, Purview Information Protection,
 * and Microsoft 365 Defender advanced hunting data — device, email and identity
 * events, which is what mde, mdi and mdo model.
 *
 * That fourth category is the largest by volume and was previously excluded, so
 * the grant was capped by a small eligible pool instead of by the allowance.
 * At 500 users that under-applied roughly £115/month of credit; at 50,000 users,
 * around £11,500/month.
 *
 * Purview Information Protection has no corresponding source in the estimator.
 */
export const E5_GRANT_ELIGIBLE_SOURCE_IDS: ReadonlySet<string> = new Set([
  // 'mde-servers' is deliberately ABSENT. Its Device* tables look like the
  // workstation ones, but the E5 grant is denominated per licensed USER while
  // servers are covered by a separate per-server benefit, and Microsoft states
  // the two offers "are separate products, so one won't cover the other". It
  // does not say which side server-generated advanced hunting data falls on.
  // Leaving it out shows a higher cost, which is the safe direction to be
  // wrong in; granting it would understate the bill on an unverified reading.
  'entra-id',
  'mdca',
  'mde',
  'mdi',
  'mdo',
])

/**
 * Licences that activate the 5 MB/user/day Sentinel data grant.
 * Microsoft 365 E7, E5, A5, F5 and G5, plus the E5 Security add-on.
 * The published offer also includes the A5, F5 and G5 Security add-ons;
 * those are the same grant, so a customer on the add-on alone selects the
 * matching suite here.
 * https://azure.microsoft.com/en-us/pricing/offers/sentinel-microsoft-365-offer/
 */
export const E5_QUALIFYING_LICENCES: ReadonlySet<M365Licence> = new Set([
  'e5',
  'e5-security',
  'e7',
  'a5',
  'f5',
  'g5',
])

// ─── Security Copilot inclusion ───────────────────────────────────────────────

/**
 * Security compute units included with Microsoft 365 E5 and E7.
 * 400 SCUs a month for every 1,000 paid user licences, capped at 10,000.
 * https://learn.microsoft.com/en-us/copilot/security/security-copilot-inclusion
 */
export const SECURITY_COPILOT_SCUS_PER_THOUSAND_LICENCES = 400
export const SECURITY_COPILOT_MONTHLY_CAP_SCUS = 10_000

/** The inclusion article names E5 and E7. Other grant SKUs are not listed. */
export const SECURITY_COPILOT_LICENCES: ReadonlySet<M365Licence> = new Set(['e5', 'e7'])

/**
 * Licences that can opt into Defender ISOC.
 * The Ignite 2026 post names Microsoft 365 E5, Microsoft 365 E7 and Microsoft
 * Defender Suite. This calculator has no Defender Suite licence, so that path
 * cannot be selected here. E5 Security is not named in that post.
 * https://techcommunity.microsoft.com/blog/microsoftsentinelblog/ignite-2026-whats-new-in-microsoft-sentinel/4571174
 */
export const ISOC_ELIGIBLE_LICENCES: ReadonlySet<M365Licence> = new Set(['e5', 'e7'])

export function isocBillingAllowed(licence: M365Licence): boolean {
  return ISOC_ELIGIBLE_LICENCES.has(licence)
}

/** Included SCUs for a paid-licence count. Zero when the count is not usable. */
export function includedSecurityCopilotScus(paidUserLicences: number): number {
  if (!Number.isFinite(paidUserLicences) || paidUserLicences <= 0) return 0
  const raw = (paidUserLicences * SECURITY_COPILOT_SCUS_PER_THOUSAND_LICENCES) / 1000
  return Math.min(SECURITY_COPILOT_MONTHLY_CAP_SCUS, raw)
}

// ─── Defender for Servers P2 ──────────────────────────────────────────────────

/** Free Sentinel ingestion allowance per enrolled server per day */
export const DEFENDER_SERVERS_FREE_GB_PER_SERVER_PER_DAY = 0.5

// ─── Always-Free Sources (informational) ─────────────────────────────────────

export interface AlwaysFreeInfo {
  id: string
  label: string
  description: string
}

/**
 * Sources Microsoft does not charge Sentinel ingestion for, regardless of
 * licence. Listed here for informational display — they are not part of
 * the billing credit calculation.
 */
export const ALWAYS_FREE_SOURCES: AlwaysFreeInfo[] = [
  {
    id: 'azure-activity',
    label: 'Azure Activity Logs',
    description: 'Free in Sentinel — modelled in the estimator',
  },
  {
    id: 'o365-mgmt',
    label: 'O365 Management Activity',
    description: 'Management activity audit records — free table in Sentinel',
  },
  {
    id: 'defender-alerts',
    label: 'Defender XDR / MDE / MDI / MDO / MDCA alerts',
    description: 'Alert & incident metadata only — free tables; raw telemetry is billable',
  },
  {
    id: 'defender-cloud',
    label: 'Defender for Cloud alerts',
    description: 'Security alert records — free table in Sentinel',
  },
]
