// @vitest-environment node
/**
 * The query is a string we hand to a user to run against their own workspace.
 * Nothing in the build can execute KQL, so these assert the syntax rules that
 * have actually bitten — starting with the one that shipped broken.
 */

import { describe, it, expect } from 'vitest'
import { USAGE_QUERY, USAGE_LOOKBACK_DAYS, MB_PER_GB_BILLING } from '../usageQuery'

describe('USAGE_QUERY syntax', () => {
  it('passes ago() a timespan literal, not a bare number', () => {
    // Shipped as `let LookbackDays = 31;` then `ago(LookbackDays)`, which KQL
    // rejects: "argument #1 was not of an expected data type: timespan".
    expect(USAGE_QUERY).toContain(`let Lookback = ${USAGE_LOOKBACK_DAYS}d;`)
    expect(USAGE_QUERY).toMatch(/ago\(Lookback\)/)
  })

  it('never passes a bare integer to ago()', () => {
    // Guards the general shape rather than just the one instance.
    expect(USAGE_QUERY).not.toMatch(/ago\(\s*\d+\s*\)/)
  })

  it('declares every let-binding it references', () => {
    const declared = new Set([...USAGE_QUERY.matchAll(/let\s+(\w+)\s*=/g)].map(m => m[1]))
    // Identifiers used inside the pipeline that look like bindings.
    for (const name of ['Lookback', 'PeriodStart', 'PeriodEnd']) {
      expect(declared.has(name), `${name} is used but never declared`).toBe(true)
    }
  })

  it('carries an explicit TimeGenerated filter', () => {
    // Without this the Azure portal time picker silently truncates the window
    // to 24 hours, and the user pastes a thirtieth of their real volume.
    expect(USAGE_QUERY).toMatch(/where\s+TimeGenerated\s*>=/)
  })

  it('guards IsBillable against arriving as a string', () => {
    // Some workspaces return it as a string; `== true` silently matches nothing.
    expect(USAGE_QUERY).toContain('tostring(IsBillable)')
  })

  it('groups by Plan, since commitment tiers cover Analytics volume only', () => {
    expect(USAGE_QUERY).toMatch(/by\s+TableName\s*=\s*DataType,\s*Plan/)
  })

  it('returns megabytes, so the billing divisor stays in tested code', () => {
    expect(USAGE_QUERY).toContain('TotalMB')
    expect(USAGE_QUERY).toContain('BillableMB')
    // The divisor must not appear in the query at all.
    expect(USAGE_QUERY).not.toContain(String(MB_PER_GB_BILLING))
    expect(USAGE_QUERY).not.toContain('1024')
  })

  it('has balanced parentheses', () => {
    const open = (USAGE_QUERY.match(/\(/g) ?? []).length
    const close = (USAGE_QUERY.match(/\)/g) ?? []).length
    expect(open).toBe(close)
  })

  it('terminates every let-binding with a semicolon', () => {
    for (const line of USAGE_QUERY.split('\n')) {
      if (line.trimStart().startsWith('let ')) {
        expect(line.trimEnd().endsWith(';'), `missing semicolon: ${line}`).toBe(true)
      }
    }
  })
})
