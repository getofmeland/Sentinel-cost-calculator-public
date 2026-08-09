import type { AnalysisResult, LicensingInput } from './analysis'
import { csvField, toCsv } from './csvExport'
import { fmtCurrency, type CurrencyCode } from './currency'
import { DAYS_PER_MONTH } from '../data/pricing'

/**
 * Deliverables for Analyse mode.
 *
 * Until this existed the mode's output could not leave the browser — no CSV, no
 * print, no link. Two consultant reviews reached the same verdict independently:
 * a tool whose findings have to be retyped into Word is a lookup, not a tool.
 *
 * TWO FORMATS, DELIBERATELY.
 *
 * Markdown is the deliverable. The value in this analysis is not the numbers —
 * it is the reasoning attached to them: which detections a tier move breaks,
 * why a grant already covers something, what a filter costs you in visibility.
 * That prose is unreadable in a spreadsheet cell and is exactly what a client
 * report needs, so it is written as a document that pastes into Word or
 * Confluence intact.
 *
 * CSV is the data. Per-table rows for anyone who wants to pivot, sort or
 * reconcile against an invoice.
 *
 * Both record their assumptions. A cost figure without the licence, seat count,
 * commitment tier and exclusions that produced it cannot be defended a month
 * later, and the estimator's own CSV was criticised for exactly that.
 */

export interface AnalysisExportOptions {
  result: AnalysisResult
  licensing: LicensingInput
  currency: CurrencyCode
  fxRate: number
  eurRate: number
  region: string
  /** Complete days the Usage query measured */
  lookbackDays: number
  /** Parser warnings — a deliverable must carry the caveats on its own input */
  warnings: string[]
  /** Passed in rather than read from the clock, so output is reproducible */
  generatedAt: Date
}

/** What this analysis structurally cannot see. Stated in every export. */
const EXCLUSIONS = [
  'Data retention. Interactive retention beyond 90 days and long-term retention are billed per GB '
  + 'per month and are not visible to the Usage query, so no retention cost appears anywhere below.',
  'Sentinel data lake usage — ingestion, query, storage and the graph and notebook compute meters.',
  'Search jobs and restore. Shortening retention has a cost when the data is needed back.',
  'Automation. Logic Apps playbooks and any Azure Functions your connectors run bill separately.',
  'Tables configured but idle in the measured period, which cost retention while reporting no ingestion.',
  'Any agreement discount. Everything here is public list pricing.',
]

/** Operational constraints that decide the ORDER of work, not just its value. */
const SEQUENCING = [
  'Microsoft permits one table plan change per table per week, so a large re-tiering runs over '
  + 'several weeks rather than in one change window.',
  'A commitment tier can be increased at any time but lowered only every 31 days. If the moves below '
  + 'reduce your Analytics volume, reduce the tier FIRST or you pay the old commitment on volume you '
  + 'are no longer sending.',
  'Moving a table to the Lake tier stops alerts on that table. Confirm which analytics rules read it '
  + 'before the change, not after.',
  'A data collection rule transformation can take up to 60 minutes to take effect, and a workspace '
  + 'transformation is ignored for data that arrived through another DCR.',
]

function assumptionRows(o: AnalysisExportOptions): Array<[string, string]> {
  const l = o.licensing
  return [
    ['Generated', o.generatedAt.toISOString().slice(0, 10)],
    ['Measurement period', `${o.lookbackDays} complete days`],
    ['Azure region', o.region],
    ['Currency', `${o.currency} at ${o.fxRate} per USD`],
    ['Commitment tier in place', o.result.currentTierLabel],
    ['Microsoft 365 licence', l.licence === 'none' ? 'None stated' : l.licence.toUpperCase()],
    [
      'Licensed seats',
      l.licence === 'none' ? 'n/a' : `${l.licensedSeats.toLocaleString()} (grant is per licensed seat, not per account)`,
    ],
    [
      'Defender for Servers Plan 2',
      l.defenderServersP2Enabled
        ? `Enabled on the workspace, ${l.serverCount.toLocaleString()} servers`
        : 'Not enabled',
    ],
  ]
}

/**
 * The client-facing document.
 *
 * Ordered as a consultant would present it: what it covers, what was assumed,
 * the headline, then the actions in the order they should actually be done —
 * with the reasoning and the risk kept attached to each one rather than
 * stripped out to make a tidier table.
 */
export function buildAnalysisMarkdown(o: AnalysisExportOptions): string {
  const { result: r } = o
  const money = (usd: number) => fmtCurrency(usd, o.currency, o.fxRate, o.eurRate, 0)
  const gb = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: 2 })
  const out: string[] = []

  out.push('# Microsoft Sentinel cost analysis', '')
  out.push(
    'Produced from measured ingestion in a single Log Analytics workspace. These are planning '
    + 'figures based on public Azure list pricing, not a quote.',
    '',
  )

  out.push('## Assumptions', '')
  out.push('| Input | Value |', '| --- | --- |')
  for (const [k, v] of assumptionRows(o)) out.push(`| ${k} | ${v} |`)
  out.push('')

  if (o.warnings.length > 0) {
    out.push('### Caveats on the measurement itself', '')
    for (const w of o.warnings) out.push(`- ${w}`)
    out.push('')
  }

  out.push('## Summary', '')
  out.push('| | |', '| --- | --- |')
  out.push(`| Current monthly spend on measured ingestion | **${money(r.currentMonthlyUsd)}** |`)
  if (r.p2GrantedGbPerDay > 0) {
    out.push(`| Already free — Defender for Servers Plan 2 | ${gb(r.p2GrantedGbPerDay)} GB/day, worth ${money(r.p2GrantSavedMonthlyUsd)}/mo |`)
  }
  if (r.e5GrantedGbPerDay > 0) {
    out.push(`| Already free — Microsoft 365 E5 data grant | ${gb(r.e5GrantedGbPerDay)} GB/day, worth ${money(r.e5GrantSavedMonthlyUsd)}/mo |`)
  }
  out.push(`| Identified saving | **${money(r.totalAddressableSavingUsd)}/mo** |`)
  out.push(`| Analytics volume after the moves below | ${gb(r.analyticsGbPerDayAfterMoves)} GB/day |`)
  if (r.recommendedTierLabel) out.push(`| Recommended commitment tier | ${r.recommendedTierLabel} |`)
  out.push(`| Volume excluded from advice | ${gb(r.unclassifiedGbPerDay)} GB/day, ${money(r.unclassifiedMonthlyUsd)}/mo across ${r.unclassifiedTableCount} tables |`)
  out.push('')

  const substantiated = r.opportunities.filter(op => !op.needsUserInput && op.monthlySavingUsd > 0)
  const questions = r.opportunities.filter(op => op.needsUserInput)

  if (substantiated.length > 0) {
    out.push('## Actions', '')
    out.push(
      'Applied in this order. Each saving is measured against what the previous action leaves, so '
      + 'the figures add up rather than counting the same gigabytes twice.',
      '',
    )
    substantiated.forEach((op, i) => {
      out.push(`### ${i + 1}. ${op.title} — ${money(op.monthlySavingUsd)}/mo`, '')
      out.push(op.detail, '')
      if (op.tables.length > 0) {
        out.push(`**Tables:** ${op.tables.join(', ')}`, '')
      }
    })
  }

  if (questions.length > 0) {
    out.push('## Questions to answer before acting', '')
    out.push(
      'These are not findings. They are decisions the measurement cannot make for you, listed with '
      + 'the amount at stake so they can be prioritised.',
      '',
    )
    for (const op of questions) {
      const stake = op.contextUsd && op.contextUsd > 0 ? ` — ${money(op.contextUsd)}/mo at stake` : ''
      out.push(`### ${op.title}${stake}`, '')
      out.push(op.detail, '')
      if (op.tables.length > 0) out.push(`**Tables:** ${op.tables.join(', ')}`, '')
    }
  }

  out.push('## Order of work', '')
  for (const s of SEQUENCING) out.push(`- ${s}`)
  out.push('')

  if (r.offeredTransforms.length > 0) {
    out.push('## Filtering at ingestion', '')
    out.push(
      'A data collection rule transformation drops rows before they are stored, so they are never '
      + 'billed at all — which beats moving a table to a cheaper plan. No saving is claimed: how much '
      + 'each filter removes depends entirely on what your estate sends. Run each snippet as a query '
      + 'first, with the table name in place of `source`, to measure the real effect.',
      '',
    )
    for (const t of r.offeredTransforms) {
      const title = t.transform.title ? `${t.tableName} — ${t.transform.title}` : t.tableName
      out.push(`### ${title}`, '')
      out.push(`Currently ${money(t.monthlyCostUsd)}/mo.`, '')
      out.push('```kusto', t.transform.transformKql, '```', '')
      out.push(`**What it removes.** ${t.transform.reductionNote}`, '')
      out.push(`**What you lose.** ${t.transform.risk}`, '')
    }
  }

  out.push('## Table detail', '')
  out.push('| Table | Plan | GB/day | Free under grant | Cost/mo | Finding |', '| --- | --- | ---: | ---: | ---: | --- |')
  for (const t of r.tables) {
    const finding = t.status === 'ok' ? '—' : STATUS_TEXT[t.status]
    out.push([
      '', t.tableName, t.plan, gb(t.billableGbPerDay),
      t.grantedGbPerDay > 0 ? gb(t.grantedGbPerDay) : '—',
      money(t.monthlyCostUsd), finding, '',
    ].join(' | ').trim())
  }
  out.push('')

  out.push('## What this analysis does not cover', '')
  for (const e of EXCLUSIONS) out.push(`- ${e}`)
  out.push('')

  return out.join('\n')
}

const STATUS_TEXT: Record<string, string> = {
  'move-to-lake': 'Move to Data Lake',
  'move-to-basic': 'Move to Basic',
  'should-be-free': 'Billed but should be free',
  'needs-input': 'Shared table — needs your input',
  unclassified: 'Not recognised, excluded from advice',
  ok: '—',
}

/** The same analysis as rows, for anyone reconciling in a spreadsheet. */
export function buildAnalysisCsv(o: AnalysisExportOptions): string {
  const { result: r } = o
  const money = (usd: number) => (usd * (o.currency === 'EUR' ? o.eurRate : o.currency === 'GBP' ? o.fxRate : 1)).toFixed(2)

  const rows: Array<Array<string | number>> = [['Microsoft Sentinel cost analysis']]
  for (const [k, v] of assumptionRows(o)) rows.push([k, v])
  rows.push(['Note', 'Planning figures from public Azure list pricing. Not a quote.'])
  rows.push(['Excludes', EXCLUSIONS.join(' ')])

  if (o.warnings.length > 0) rows.push(['Measurement caveats', o.warnings.join(' ')])

  rows.push(
    [],
    ['Table', 'Plan', 'Billable GB/day', 'Free under grant GB/day', `Cost per month (${o.currency})`,
      'Finding', `Saving if actioned (${o.currency})`, 'Recommended tier', 'Notes'],
  )
  for (const t of r.tables) {
    rows.push([
      t.tableName,
      t.plan,
      t.billableGbPerDay.toFixed(3),
      t.grantedGbPerDay.toFixed(3),
      money(t.monthlyCostUsd),
      STATUS_TEXT[t.status] ?? t.status,
      t.potentialSavingUsd > 0 ? money(t.potentialSavingUsd) : '',
      t.match?.recommendation ?? '',
      t.match?.caveat ?? t.attribution?.connectors.join('; ') ?? t.guess?.note ?? '',
    ])
  }

  rows.push(
    [],
    ['Opportunity', `Saving per month (${o.currency})`, 'Needs your input', 'Tables'],
  )
  for (const op of r.opportunities) {
    rows.push([
      op.title,
      op.monthlySavingUsd > 0 ? money(op.monthlySavingUsd) : '',
      op.needsUserInput ? 'Yes' : 'No',
      op.tables.join('; '),
    ])
  }

  rows.push(
    [],
    ['Summary', `Monthly (${o.currency})`],
    ['Current spend on measured ingestion', money(r.currentMonthlyUsd)],
    ['Free under Defender for Servers Plan 2', money(r.p2GrantSavedMonthlyUsd)],
    ['Free under Microsoft 365 E5 grant', money(r.e5GrantSavedMonthlyUsd)],
    ['Identified saving', money(r.totalAddressableSavingUsd)],
    ['Excluded from advice (unrecognised)', money(r.unclassifiedMonthlyUsd)],
    [],
    ['Analytics GB/day after moves', r.analyticsGbPerDayAfterMoves.toFixed(2)],
    ['Days in month used', DAYS_PER_MONTH],
  )

  return toCsv(rows)
}

/** Client-side download for any text payload. No server round-trip. */
export function downloadText(filename: string, content: string, mime: string): void {
  // The BOM makes Excel open UTF-8 correctly, which matters for £ and € signs.
  const blob = new Blob(['﻿' + content], { type: `${mime};charset=utf-8;` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** Exported for tests that assert the CSV escaping survives long risk prose. */
export const __csvField = csvField
