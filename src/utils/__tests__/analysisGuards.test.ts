// @vitest-environment node
/**
 * Runtime plan-support guards, exercised with deliberately poisoned data.
 *
 * An adversarial review proved these guards were dead code under test: the
 * catalogue tests forbid the very data (a 'basic' or 'data-lake' recommendation
 * on a table that cannot use the plan) that would make the engine-level checks
 * fire, so replacing either check with `true` passed the entire suite. That is
 * the exact failure shape of the sixteen impossible Lake recommendations that
 * shipped — a safety check that reads correct but never actually runs. These
 * tests inject the poisoned TableMatch the real data can no longer produce.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../data/tableIndex', async importOriginal => {
  const real = await importOriginal<typeof import('../../data/tableIndex')>()
  const poisoned = (name: string, recommendation: 'basic' | 'data-lake') => ({
    table: name.toLowerCase(),
    sourceIds: [],
    // The poison: a cheaper-plan recommendation on a table that supports
    // neither cheaper plan. The catalogue can never say this; the engine must
    // still refuse it.
    lakeCapable: false,
    basicCapable: false,
    recommendation,
    category: null,
    caveat: null,
    description: null,
    ambiguousButAgreed: false,
    needsUserInput: false,
    reason: null,
    isFree: false,
    connectors: [],
  })
  return {
    ...real,
    matchTable: (n: string) => {
      const key = n.trim().toLowerCase()
      if (key === 'poisonedbasictable') return poisoned(n, 'basic')
      if (key === 'poisonedlaketable') return poisoned(n, 'data-lake')
      return real.matchTable(n)
    },
  }
})

import { analyseUsage } from '../analysis'
import { parseUsagePaste } from '../usageParser'

const analyse = (paste: string) => analyseUsage(parseUsagePaste(paste, 31))

describe('engine refuses a recommendation the table cannot follow, even from its own catalogue', () => {
  it('does not offer Basic when basicCapable is false, whatever the recommendation says', () => {
    const paste = `TableName\tPlan\tBillableMB\nPoisonedBasicTable\tAnalytics\t${50 * 1000 * 31}`
    const r = analyse(paste)
    expect(r.tables[0].status).toBe('ok')
    expect(r.tables[0].potentialSavingUsd).toBe(0)
    expect(r.opportunities.find(o => o.kind === 'basic-plan')).toBeUndefined()
  })

  it('does not offer the Lake tier when lakeCapable is false, whatever the recommendation says', () => {
    const paste = `TableName\tPlan\tBillableMB\nPoisonedLakeTable\tAnalytics\t${50 * 1000 * 31}`
    const r = analyse(paste)
    expect(r.tables[0].status).toBe('ok')
    expect(r.tables[0].potentialSavingUsd).toBe(0)
    expect(r.opportunities.find(o => o.kind === 'tier-placement')).toBeUndefined()
  })
})
