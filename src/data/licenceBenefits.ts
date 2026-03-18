// Microsoft Licence Benefit definitions for Sentinel billing credits
// These benefits reduce billable Analytics GB/day — they do NOT reduce ingestion volume.

export type M365Licence = 'none' | 'e3' | 'e5' | 'e5-security'

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
]

// ─── E5 Data Grant ────────────────────────────────────────────────────────────

/**
 * Each qualifying M365 E5 / E5 Security user includes 5 MB/day of free
 * Sentinel Analytics ingestion, but ONLY for Entra ID and MDCA sources.
 */
export const E5_DATA_GRANT_GB_PER_USER_PER_DAY = 0.005

/**
 * Source IDs whose Analytics-tier ingestion is eligible for the E5 data grant.
 * Only Entra ID (sign-in & audit) and Microsoft Defender for Cloud Apps qualify.
 */
export const E5_GRANT_ELIGIBLE_SOURCE_IDS: ReadonlySet<string> = new Set(['entra-id', 'mdca'])

/** Licences that activate the E5 data grant */
export const E5_QUALIFYING_LICENCES: ReadonlySet<M365Licence> = new Set(['e5', 'e5-security'])

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
