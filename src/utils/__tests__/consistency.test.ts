// @vitest-environment node
/**
 * Guard rails against the class of drift this codebase has already suffered:
 * rates copied into a second file, documentation quoting figures the code no
 * longer uses, and two components disagreeing about the same label.
 *
 * Most of these would have caught a real defect that shipped.
 */

import { describe, it, expect } from 'vitest'

// Source files are pulled in with Vite's ?raw so this suite needs no Node
// types, which would otherwise have to be added to the browser-targeted
// project and would let app code reach for fs.
import readmeSource from '../../../README.md?raw'
import claudeMdSource from '../../../CLAUDE.md?raw'
import logTiersSource from '../../data/logTiers.ts?raw'
import costSummarySource from '../../components/CostSummary.tsx?raw'
import ingestionEstimatorSource from '../../components/IngestionEstimator.tsx?raw'
import ingestionSummaryBarSource from '../../components/IngestionSummaryBar.tsx?raw'
import licenceBenefitsSource from '../../components/LicenceBenefits.tsx?raw'
import retentionPanelSource from '../../components/RetentionStrategyPanel.tsx?raw'
import sourceRowSource from '../../components/SourceRow.tsx?raw'
import stickyBarSource from '../../components/StickyTotalBar.tsx?raw'
import tierComparisonSource from '../../components/TierComparison.tsx?raw'
import tierPlacementSource from '../../components/TierPlacementTab.tsx?raw'
import tierTableSource from '../../components/TierTable.tsx?raw'
import regionSelectorSource from '../../components/RegionSelector.tsx?raw'
import breakevenChartSource from '../../components/BreakevenChart.tsx?raw'

import { AZURE_REGION_GROUPS } from '../../services/azurePricing'
import { LOG_SOURCES, PAYG_RATE_USD_PER_GB } from '../../data/pricing'
import { LOG_TIER_DEFINITIONS } from '../../data/logTiers'
import { GROUP_LABELS, GROUP_ORDER } from '../../data/sourceGroups'
import { ALWAYS_FREE_SOURCES } from '../../data/licenceBenefits'
import { TIER_PLACEMENT_DEFAULTS } from '../../data/tierPlacement'

describe('documentation matches the code', () => {
  it('README quotes the number of regions the code actually defines', () => {
    // The README claimed 18 while azurePricing.ts defined 17.
    const regionCount = AZURE_REGION_GROUPS.reduce((n, g) => n + g.regions.length, 0)
    const claim = readmeSource.match(/API for (\d+) Azure regions/)
    expect(claim, 'README should state a region count').not.toBeNull()
    expect(Number(claim![1])).toBe(regionCount)
  })

  it('no user-facing doc still advertises the old 2,000-user ceiling', () => {
    for (const [name, source] of [['README.md', readmeSource], ['CLAUDE.md', claudeMdSource]]) {
      expect(source, `${name} still cites the old range`).not.toMatch(/100[–-]2,000 users/)
    }
  })
})

describe('rate literals live only in pricing.ts', () => {
  // Every one of these was, at some point, hardcoded somewhere it should not
  // have been — including in a UI cell that then contradicted the rest of the page.
  const FORBIDDEN = [
    { value: '5.20', what: 'the old PAYG rate' },
    { value: '3.35', what: 'the old 100 GB tier rate' },
    { value: '0.023', what: 'the old analytics retention rate' },
    { value: '0.79', what: 'the old USD to GBP rate' },
    { value: '0.92', what: 'the old USD to EUR rate' },
  ]

  const COMPONENT_SOURCES: Array<[string, string]> = [
    ['CostSummary', costSummarySource],
    ['IngestionEstimator', ingestionEstimatorSource],
    ['IngestionSummaryBar', ingestionSummaryBarSource],
    ['LicenceBenefits', licenceBenefitsSource],
    ['RetentionStrategyPanel', retentionPanelSource],
    ['SourceRow', sourceRowSource],
    ['StickyTotalBar', stickyBarSource],
    ['TierComparison', tierComparisonSource],
    ['TierPlacementTab', tierPlacementSource],
    ['TierTable', tierTableSource],
    ['RegionSelector', regionSelectorSource],
    ['BreakevenChart', breakevenChartSource],
  ]

  for (const { value, what } of FORBIDDEN) {
    it(`no component hardcodes ${value} (${what})`, () => {
      for (const [name, source] of COMPONENT_SOURCES) {
        // Ignore Tailwind opacity and rgba fragments, which are not rates.
        const stripped = source.replace(/rgba?\([^)]*\)/g, '').replace(/\/\d+\b/g, '')
        expect(stripped, `${name}.tsx hardcodes ${value}`).not.toContain(value)
      }
    })
  }

  it('logTiers.ts derives its rates rather than restating them', () => {
    // It once declared 5.20, 0.023, 0.15 and 0.02 of its own, and its doc
    // comment disagreed with the constants beneath it.
    expect(logTiersSource).not.toMatch(/rateUsdPerGb:\s*\d/)
    expect(logTiersSource).not.toMatch(/extendedRetentionRateUsdPerGbPerMonth:\s*\d/)
  })

  it('the analytics tier rate equals the PAYG rate', () => {
    const analytics = LOG_TIER_DEFINITIONS.find(t => t.key === 'analytics')!
    expect(analytics.rateUsdPerGb).toBe(PAYG_RATE_USD_PER_GB)
  })
})

describe('internal data consistency', () => {
  it('every source group has a label and appears in the display order', () => {
    for (const source of LOG_SOURCES) {
      expect(GROUP_LABELS[source.group], `no label for group ${source.group}`).toBeTruthy()
      expect(GROUP_ORDER).toContain(source.group)
    }
  })

  it('group labels and order cover exactly the same set', () => {
    expect([...GROUP_ORDER].sort()).toEqual(Object.keys(GROUP_LABELS).sort())
  })

  it('sources listed as always-free are flagged isFree where they are modelled', () => {
    // pricing.ts and licenceBenefits.ts contradicted each other on o365-audit
    // and Defender for Cloud, and the billing side won — the calculator charged
    // for data Microsoft gives away.
    const byId = new Map(LOG_SOURCES.map(s => [s.id, s]))
    const aliases: Record<string, string> = {
      'o365-mgmt': 'o365-audit',
      'defender-cloud': 'mdc',
    }
    for (const entry of ALWAYS_FREE_SOURCES) {
      const sourceId = aliases[entry.id] ?? entry.id
      const source = byId.get(sourceId)
      if (!source) continue // informational entries with no modelled source
      expect(source.isFree, `${source.id} is listed as always free but is billed`).toBe(true)
    }
  })

  it('every tier placement default refers to a real source or workload', () => {
    const known = new Set([...LOG_SOURCES.map(s => s.id)])
    for (const entry of TIER_PLACEMENT_DEFAULTS) {
      const isWorkload = /^(ws|lx)-/.test(entry.sourceId)
      if (!isWorkload) {
        expect(known.has(entry.sourceId), `unknown source ${entry.sourceId}`).toBe(true)
      }
    }
  })

  it('free sources are placed on the free tier, not billed to Analytics', () => {
    const placement = new Map(TIER_PLACEMENT_DEFAULTS.map(d => [d.sourceId, d.recommendedTier]))
    for (const source of LOG_SOURCES.filter(s => s.isFree)) {
      const tier = placement.get(source.id)
      if (tier) expect(tier, `${source.id} is free but placed on ${tier}`).toBe('free')
    }
  })

  it('every source can produce a volume estimate', () => {
    for (const source of LOG_SOURCES) {
      const hasRange = source.gbPer1000UsersRange || source.gbPerDeviceRange || source.manualGbPerDay
      expect(hasRange, `${source.id} has no way to produce a volume`).toBeTruthy()
    }
  })

  it('declared ranges are ordered low to high', () => {
    for (const source of LOG_SOURCES) {
      for (const range of [source.gbPer1000UsersRange, source.gbPerDeviceRange]) {
        if (range) expect(range[0], `${source.id} range is inverted`).toBeLessThanOrEqual(range[1])
      }
    }
  })
})
