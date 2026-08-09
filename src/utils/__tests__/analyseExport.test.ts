// @vitest-environment node
/**
 * Analyse-mode deliverables.
 *
 * Two consultant reviews independently called the missing export the thing that
 * made the mode a lookup rather than a tool. The property these pin is not
 * "a file is produced" but "the file can be defended a month later" — every
 * assumption that produced a number travels with it, and every exclusion is
 * stated rather than left for the reader to discover.
 */

import { describe, it, expect } from 'vitest'
import { buildAnalysisMarkdown, buildAnalysisCsv, type AnalysisExportOptions } from '../analyseExport'
import { analyseUsage, type LicensingInput } from '../analysis'
import { parseUsagePaste } from '../usageParser'
import { STATIC_PRICING_BUNDLE } from '../../data/pricing'

const mb = (gbPerDay: number) => gbPerDay * 1000 * 31

/** The real tenant this work came from: 100 E5 seats, 162 servers. */
const LICENSING: LicensingInput = {
  licence: 'e5', licensedSeats: 100, defenderServersP2Enabled: true, serverCount: 162,
  currentCommitmentTierGbPerDay: null,
}

const PASTE = [
  'TableName\tPlan\tBillableMB',
  `SecurityEvent\tAnalytics\t${mb(3.28)}`,
  `CommonSecurityLog\tAuxiliary\t${mb(61.91)}`,
  `AppTraces\tAnalytics\t${mb(0.85)}`,
  `DeviceProcessEvents\tAnalytics\t${mb(0.96)}`,
  `SomeVendorThing_CL\tAnalytics\t${mb(0.28)}`,
].join('\n')

function options(overrides: Partial<AnalysisExportOptions> = {}): AnalysisExportOptions {
  const parsed = parseUsagePaste(PASTE, 31)
  return {
    result: analyseUsage(parsed, STATIC_PRICING_BUNDLE, undefined, LICENSING),
    licensing: LICENSING,
    currency: 'GBP',
    fxRate: 0.7425,
    eurRate: 0.8657,
    region: 'UK South',
    lookbackDays: 31,
    warnings: parsed.warnings,
    // Fixed so the output is reproducible; the component passes a real date.
    generatedAt: new Date('2026-08-09T00:00:00Z'),
    ...overrides,
  }
}

describe('the report records what produced it', () => {
  const md = buildAnalysisMarkdown(options())

  it('states the date, period, region and currency', () => {
    expect(md).toContain('2026-08-09')
    expect(md).toContain('31 complete days')
    expect(md).toContain('UK South')
    expect(md).toContain('GBP at 0.7425 per USD')
  })

  it('states the licensing that drove the grants', () => {
    // Without these the credits look arbitrary and cannot be checked.
    expect(md).toContain('E5')
    expect(md).toMatch(/100.*licensed seat/i)
    expect(md).toContain('162 servers')
  })

  it('states the commitment tier the costs are based on', () => {
    expect(md).toMatch(/Commitment tier in place \| Pay-as-you-go/)
  })

  it('names every excluded cost component rather than going quiet', () => {
    // The mode measures ingestion only. A reader who assumes it is the whole
    // bill will under-quote, so the gaps are stated in the deliverable itself.
    for (const term of [/retention/i, /search jobs/i, /restore/i, /Logic Apps/i, /list pricing/i]) {
      expect(md).toMatch(term)
    }
  })

  it('carries the parser caveats when the paste itself was imperfect', () => {
    const opts = options({ warnings: ['3 rows had an unreadable billable volume and were excluded.'] })
    expect(buildAnalysisMarkdown(opts)).toContain('unreadable billable volume')
  })
})

describe('the report is an action plan, not just numbers', () => {
  const md = buildAnalysisMarkdown(options())

  it('keeps the reasoning attached to each action', () => {
    // The value is the caveats, not the figures. Stripping them to tidy the
    // table is what makes a report unusable.
    expect(md).toContain('## Actions')
    expect(md).toMatch(/scheduled analytics rules|alerts stop working/i)
  })

  it('states the operational order of work', () => {
    expect(md).toContain('## Order of work')
    expect(md).toMatch(/one table plan change per table per week/i)
    expect(md).toMatch(/lowered only every 31 days/i)
  })

  it('separates questions from findings', () => {
    // Anything needing user input must not sit in the same list as a costed
    // saving, or it reads as banked.
    const opts = options()
    if (opts.result.opportunities.some(o => o.needsUserInput)) {
      expect(md).toContain('## Questions to answer before acting')
    }
  })

  it('includes the ingestion filters with their risk text intact', () => {
    const opts = options()
    if (opts.result.offeredTransforms.length > 0) {
      expect(md).toContain('```kusto')
      expect(md).toContain('**What you lose.**')
    }
  })

  it('shows volume it could not advise on rather than hiding it', () => {
    expect(md).toMatch(/excluded from advice/i)
    expect(md).toContain('SomeVendorThing_CL')
  })
})

describe('the CSV is checkable data', () => {
  const csv = buildAnalysisCsv(options())

  it('carries the same assumptions as the report', () => {
    expect(csv).toContain('Generated')
    expect(csv).toContain('Licensed seats')
    expect(csv).toContain('Commitment tier in place')
    expect(csv).toContain('Excludes')
  })

  it('has one row per table with its grant and finding', () => {
    expect(csv).toContain('Billable GB/day')
    expect(csv).toContain('Free under grant GB/day')
    expect(csv).toContain('SecurityEvent')
    expect(csv).toContain('CommonSecurityLog')
  })

  it('quotes fields containing commas and newlines', () => {
    // Risk prose is long and full of commas; an unquoted field would shift
    // every later column, which is the defect the parser guards against on the
    // way in and the export must not create on the way out.
    const lines = csv.split('\r\n')
    for (const line of lines) {
      const outsideQuotes = line.replace(/"(?:[^"]|"")*"/g, '')
      expect(outsideQuotes.split(',').length).toBeLessThan(40)
    }
  })

  it('never emits a field a spreadsheet would execute', () => {
    // Table names come from a paste, so they are untrusted input.
    const hostile = parseUsagePaste(
      `TableName\tPlan\tBillableMB\n=cmd|' /C calc'!A1\tAnalytics\t${mb(1)}`, 31,
    )
    const csvOut = buildAnalysisCsv(options({
      result: analyseUsage(hostile, STATIC_PRICING_BUNDLE, undefined, LICENSING),
    }))
    for (const line of csvOut.split('\r\n')) {
      for (const field of line.split(',')) {
        expect(field.replace(/^"/, '').startsWith('=')).toBe(false)
      }
    }
  })
})

describe('currency', () => {
  it('writes amounts in the currency shown on screen, with the rate stated', () => {
    const eur = buildAnalysisMarkdown(options({ currency: 'EUR' }))
    expect(eur).toContain('EUR at')
    expect(eur).toContain('€')
    expect(eur).not.toContain('£')
  })
})
