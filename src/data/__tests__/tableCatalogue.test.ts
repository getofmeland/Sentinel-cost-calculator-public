import { describe, it, expect } from 'vitest'
import { TABLE_CATALOGUE } from '../tableCatalogue'
import { matchTable, isAlwaysFreeTable } from '../tableIndex'

/**
 * These cover the attributes that change what the tool *advises*, not merely
 * what it displays. Every value asserted here was read off the table's
 * reference page on learn.microsoft.com rather than inferred from its name —
 * the whole point of the catalogue is that naming convention is not evidence.
 */

describe('table catalogue integrity', () => {
  it('has no duplicate table names', () => {
    const seen = new Map<string, number>()
    for (const e of TABLE_CATALOGUE) {
      const k = e.name.toLowerCase()
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
    expect([...seen].filter(([, n]) => n > 1)).toEqual([])
  })

  it('never marks a free table as needing a paid tier', () => {
    for (const e of TABLE_CATALOGUE) {
      if (!e.billable) expect(e.recommendedTier).toBe('free')
    }
  })

  it('never recommends the Lake tier for a table that cannot use it', () => {
    // The failure this guards against is advice the customer physically cannot
    // follow. Microsoft publishes "Auxiliary / Lake table support: No" for a
    // number of tables and no cost pressure changes that.
    const impossible = TABLE_CATALOGUE.filter(
      e => e.recommendedTier === 'data-lake' && !e.lakeCapable,
    )
    expect(impossible.map(e => e.name)).toEqual([])
  })
})

describe('tables reported as unrecognised by a live tenant', () => {
  // Supplied verbatim by a tester running the tool against a real workspace.
  const reported = [
    'DeviceImageLoadEvents', 'DeviceRegistryEvents', 'DeviceFileCertificateInfo',
    'AlertInfo', 'SecurityIncident', 'Watchlist', 'Anomalies',
    'SentinelHealth', 'SentinelAudit', 'AWSVPCFlow', 'AWSCloudTrail',
    'ThreatIntelIndicators',
  ]

  it.each(reported)('resolves %s', name => {
    expect(matchTable(name)).not.toBeNull()
  })

  it('resolves regardless of the casing the portal exports', () => {
    expect(matchTable('deviceregistryevents')).not.toBeNull()
    expect(matchTable('  DEVICEREGISTRYEVENTS  ')).not.toBeNull()
  })
})

describe('Defender XDR tables and the E5 grant', () => {
  const xdr = [
    'DeviceImageLoadEvents', 'DeviceRegistryEvents',
    'DeviceFileCertificateInfo', 'AlertInfo',
  ]

  it.each(xdr)('%s stays on Analytics', name => {
    // These tables are the pool the 5 MB/user/day Defender grant is drawn
    // from. Moving them to the Lake tier would start charging for data that
    // currently ingests free — the opposite of an optimisation.
    expect(matchTable(name)?.recommendation).toBe('analytics')
  })

  it('flags AlertInfo as billable even though SecurityAlert is free', () => {
    expect(matchTable('AlertInfo')?.isFree).toBe(false)
    expect(matchTable('AlertInfo')?.caveat).toMatch(/SecurityAlert is free/i)
  })
})

describe('billability matches the Microsoft free-data list', () => {
  it('treats SecurityIncident as free', () => {
    expect(matchTable('SecurityIncident')?.isFree).toBe(true)
    expect(isAlwaysFreeTable('SecurityIncident')).toBe(true)
  })

  it('treats SentinelAudit as billable and SentinelHealth as free', () => {
    // Adjacent names, opposite billing. Worth pinning so a future edit to one
    // does not get copy-pasted onto the other.
    expect(matchTable('SentinelHealth')?.isFree).toBe(true)
    expect(matchTable('SentinelAudit')?.isFree).toBe(false)
  })

  it('treats Watchlist as billable and not Lake-capable', () => {
    const m = matchTable('Watchlist')
    expect(m?.isFree).toBe(false)
    expect(m?.lakeCapable).toBe(false)
  })
})
