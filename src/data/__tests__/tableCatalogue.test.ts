import { describe, it, expect } from 'vitest'
import { TABLE_CATALOGUE } from '../tableCatalogue'
import { matchTable, guessTable, isAlwaysFreeTable, attributeTable, indexedTableCount } from '../tableIndex'
import { publishedPlanSupport, verifiedTableCount } from '../tablePlanSupport'
import { attributedTableCount } from '../connectorIndex'
import { P2_ELIGIBLE_TABLES, E5_ELIGIBLE_TABLES } from '../grantEligibleTables'

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

  it('never recommends the Basic plan for a table that cannot use it', () => {
    const impossible = TABLE_CATALOGUE.filter(
      e => e.recommendedTier === 'basic' && !e.basicCapable,
    )
    expect(impossible.map(e => e.name)).toEqual([])
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

describe('catalogue agrees with what Microsoft publishes', () => {
  // The guard that produced this suite. A previous release recommended moving
  // sixteen operational tables to the Lake tier; none of them support it. The
  // refusal logic was correct and the data was assumed, so nothing caught it.
  it('every catalogued lakeCapable matches the published value', () => {
    const wrong: string[] = []
    for (const e of TABLE_CATALOGUE) {
      const published = publishedPlanSupport(e.name)
      if (!published) continue
      if (published.lake !== e.lakeCapable) {
        wrong.push(`${e.name}: catalogue says ${e.lakeCapable}, Microsoft says ${published.lake}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('every catalogued basicCapable matches the published value', () => {
    const wrong: string[] = []
    for (const e of TABLE_CATALOGUE) {
      const published = publishedPlanSupport(e.name)
      if (!published) continue
      if (published.basic !== e.basicCapable) {
        wrong.push(`${e.name}: catalogue says ${e.basicCapable}, Microsoft says ${published.basic}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('undocumented tables claim no plan support', () => {
    // Unverified is not the same as supported. A table Microsoft does not
    // document must not be offered a move we cannot price — on EITHER cheaper
    // plan. This originally guarded only the Lake side; a review pointed out an
    // undocumented table could still be authored basicCapable and every test
    // would pass.
    for (const e of TABLE_CATALOGUE) {
      if (publishedPlanSupport(e.name)) continue
      expect(
        { table: e.name, lakeCapable: e.lakeCapable, basicCapable: e.basicCapable },
      ).toEqual(
        { table: e.name, lakeCapable: false, basicCapable: false },
      )
      expect(e.recommendedTier).not.toBe('data-lake')
      expect(e.recommendedTier).not.toBe('basic')
    }
  })

  it('carries a meaningful number of verified and attributed tables', () => {
    // Guards against a regeneration silently producing an empty file.
    expect(verifiedTableCount()).toBeGreaterThan(150)
    expect(attributedTableCount()).toBeGreaterThan(600)
    expect(indexedTableCount()).toBeGreaterThan(100)
  })
})

describe('connector attribution', () => {
  it('names the connector for custom tables the catalogue does not cover', () => {
    const a = attributeTable('alertsdlpdata_CL')
    expect(a?.connectors).toContain('Netskope Data Connector')
    expect(a?.customSchema).toBe(true)
  })

  it('records every connector for a table several of them write to', () => {
    const a = attributeTable('AzureDiagnostics')
    expect((a?.connectors.length ?? 0)).toBeGreaterThan(1)
  })

  it('flags ASIM tables by prefix rather than a list that would go stale', () => {
    expect(attributeTable('ASimDnsActivityLogs')?.asim).toBe(true)
    expect(attributeTable('AWSCloudTrail')?.asim).toBe(false)
  })

  it('is case-insensitive and tolerates the whitespace a paste brings', () => {
    expect(attributeTable('  awscloudtrail  ')?.name).toBe('AWSCloudTrail')
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

describe('a guess names a family and makes no billing claim', () => {
  // A real tenant was shown "Likely Defender XDR… eligible for the M365 E5 data
  // grant" against BehaviorAnalytics — Sentinel UEBA output, £61/month, not
  // Defender XDR and not grant-eligible. A prefix match produced a billing
  // claim, which is worse than the tier recommendation this function was
  // carefully built never to produce.

  const PREFIXES = [
    'AWSSomethingNew', 'GCPSomethingNew', 'DeviceSomethingNew', 'EmailSomethingNew',
    'AADSomethingNew', 'EntraSomethingNew', 'AppSomethingNew', 'ThreatIntelSomethingNew',
    'Whatever_CL',
  ]

  it('never asserts grant eligibility', () => {
    // Directing someone to CHECK grant eligibility is honest and useful; the
    // banned thing is asserting it. So the test targets assertive phrasing
    // rather than the word, which would also forbid the good advice.
    for (const name of PREFIXES) {
      const g = guessTable(name)
      if (!g) continue
      expect(g.note, `${name} asserts eligibility`)
        .not.toMatch(/eligible for|covered by|qualifies for/i)
    }
  })

  it('never asserts a table is billable or free', () => {
    for (const name of PREFIXES) {
      const g = guessTable(name)
      if (!g) continue
      // The paste carries the customer's own BillableMB, so billability is
      // measured. A guess has nothing to add and everything to get wrong.
      expect(g.note, `${name} asserts billability`).not.toMatch(/\bbillable\b|\bfree to ingest\b/i)
    }
  })

  it('resolves the UEBA tables by name instead of guessing at them', () => {
    for (const t of ['BehaviorAnalytics', 'UserPeerAnalytics', 'UserAccessAnalytics']) {
      expect(matchTable(t), `${t} should be catalogued`).not.toBeNull()
      expect(guessTable(t), `${t} should not need a guess`).toBeNull()
    }
  })

  it('does not treat Sentinel UEBA output as Defender XDR', () => {
    const m = matchTable('BehaviorAnalytics')!
    expect(m.caveat).toMatch(/not covered by the E5 data grant/i)
    // Neither cheaper plan is available, so no move may be offered.
    expect(m.lakeCapable).toBe(false)
    expect(m.basicCapable).toBe(false)
    expect(m.recommendation).toBe('analytics')
  })

  it('still resolves the genuine Defender XDR behaviour tables', () => {
    // Removing the prefix must not lose the real ones.
    for (const t of ['BehaviorInfo', 'BehaviorEntities']) {
      expect(matchTable(t), `${t} should be catalogued`).not.toBeNull()
    }
  })
})

describe('the grant and the catalogue cover the same tables', () => {
  // A table the engine credits but the report cannot name shows as
  // "Unrecognised" next to a cost that has silently been reduced. The reader
  // has no way to tell those two facts are connected.
  it('resolves every table the Defender for Servers grant covers', () => {
    const unresolved = [...P2_ELIGIBLE_TABLES].filter(t => !matchTable(t))
    expect(unresolved).toEqual([])
  })

  it('resolves every table the E5 data grant covers', () => {
    const unresolved = [...E5_ELIGIBLE_TABLES].filter(t => !matchTable(t))
    expect(unresolved).toEqual([])
  })
})

describe('every table a real tenant reported as unrecognised', () => {
  // The full list from a live 162-server workspace. Six turned out to be
  // eligible for a grant the tool had started applying, which is what made
  // cataloguing them urgent rather than cosmetic.
  const reported = [
    'VMConnection', 'VMBoundPort', 'VMProcess', 'VMComputer',
    'WindowsFirewall', 'SecurityBaseline', 'SecurityBaselineSummary',
    'ProtectionStatus', 'Update', 'UpdateSummary',
    'UserPeerAnalytics', 'IntuneDevices', 'AppSystemEvents',
  ]

  it.each(reported)('resolves %s', name => {
    expect(matchTable(name)).not.toBeNull()
  })

  it('offers no cheaper plan to the ones that support none', () => {
    // Most of this set publishes Basic: No and Lake: No. Recognising a table
    // must not turn into recommending a move it cannot make.
    for (const name of reported) {
      const m = matchTable(name)!
      if (m.recommendation === 'data-lake') expect(m.lakeCapable).toBe(true)
      if (m.recommendation === 'basic') expect(m.basicCapable).toBe(true)
    }
  })
})
