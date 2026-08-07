import { IngestionSummary } from './ingestion'
import { CurrencyCode } from './currency'
import { DAYS_PER_MONTH } from '../data/pricing'
import type { ComputeCostBreakdown } from './compute'

/**
 * Escape a CSV field. Quotes anything containing a delimiter, quote or newline,
 * and doubles embedded quotes, per RFC 4180.
 *
 * Also guards against formula injection: a field starting with =, +, - or @ is
 * executed by Excel and Google Sheets when the file is opened. Source labels
 * come from the repo today, but manual entries do not, and a CSV that runs code
 * on open is a poor thing to email to a client.
 */
export function csvField(value: string | number): string {
  const s = String(value)
  const needsGuard = /^[=+\-@\t\r]/.test(s)
  const guarded = needsGuard ? `'${s}` : s
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map(row => row.map(csvField).join(',')).join('\r\n')
}

export interface CsvExportOptions {
  summary: IngestionSummary
  currency: CurrencyCode
  /** Multiplier from USD into the display currency */
  fxRate: number
  paygMonthlyUsd: number
  withSavingsMonthlyUsd: number
  optimisedMonthlyUsd: number
  recommendedTierLabel: string
  userCount: number
  region: string
  /** Opt-in data lake compute; omitted from the export when nothing is enabled */
  compute?: ComputeCostBreakdown
}

/**
 * Per-source breakdown plus the headline totals, so the numbers can be checked
 * or dropped into a business case. Amounts are written in the currency shown on
 * screen, with the rate stated, rather than silently exporting USD.
 */
export function buildEstimateCsv(o: CsvExportOptions): string {
  const money = (usd: number) => (usd * o.fxRate).toFixed(2)

  const rows: Array<Array<string | number>> = [
    ['Microsoft Sentinel cost estimate'],
    ['Users', o.userCount],
    ['Azure region', o.region],
    ['Currency', o.currency],
    ['USD conversion rate', o.fxRate],
    ['Note', 'Planning estimate based on public Azure list pricing. Not a quote.'],
    [],
    ['Source', 'Tier', 'GB/day', 'Billable', `Ingestion/month (${o.currency})`, 'Retention days', `Retention/month (${o.currency})`],
  ]

  for (const row of o.summary.rows) {
    rows.push([
      row.source.label,
      row.logTier === 'data-lake' ? 'Data Lake' : 'Analytics',
      row.gbPerDay.toFixed(2),
      row.source.isFree ? 'No (free)' : 'Yes',
      money(row.dailyCostUsd * DAYS_PER_MONTH),
      row.retentionDays,
      money(row.retentionMonthlyCostUsd),
    ])
  }

  if (o.compute && o.compute.totalMonthlyUsd > 0) {
    rows.push(
      [],
      ['Data Lake compute (opt-in)', `Monthly (${o.currency})`],
      ['Graph builds', money(o.compute.graphBuildMonthlyUsd)],
      ['Graph queries', money(o.compute.graphQueryMonthlyUsd)],
      ['Notebook compute for graph builds', money(o.compute.graphNotebookMonthlyUsd)],
      ['Notebook sessions (interactive)', money(o.compute.adiInteractiveMonthlyUsd)],
      ['Notebook jobs (scheduled)', money(o.compute.adiScheduledMonthlyUsd)],
      ['Session start-up', money(o.compute.adiStartupMonthlyUsd)],
      ['Compute total', money(o.compute.totalMonthlyUsd)],
      ['Note', 'Billed per vCore-hour. Based on your activity estimates — Microsoft publishes no typical consumption figures.'],
    )
  }

  rows.push(
    [],
    ['Totals'],
    ['Total GB/day', o.summary.totalGbPerDay.toFixed(2)],
    ['Free GB/day', o.summary.freeGbPerDay.toFixed(2)],
    ['Analytics GB/day', o.summary.analyticsGbPerDay.toFixed(2)],
    ['Data Lake GB/day', o.summary.dataLakeGbPerDay.toFixed(2)],
    [],
    ['Scenario', `Monthly (${o.currency})`],
    ['Pay-as-you-go baseline', money(o.paygMonthlyUsd)],
    ['With licence benefits', money(o.withSavingsMonthlyUsd)],
    [`Commitment tier (${o.recommendedTierLabel})`, money(o.optimisedMonthlyUsd)],
  )

  return toCsv(rows)
}

/** Trigger a client-side download. No server round-trip — the tool stays static. */
export function downloadCsv(filename: string, content: string): void {
  // The BOM makes Excel open UTF-8 correctly, which matters for the £ and € signs.
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
