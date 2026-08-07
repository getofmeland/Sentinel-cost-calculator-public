import { useState } from 'react'
import { parseUsagePaste, UsageParseError, type ParsedUsage } from '../../utils/usageParser'

interface Props {
  onParsed: (usage: ParsedUsage | null) => void
  parsed: ParsedUsage | null
}

/**
 * Step two: the paste box.
 *
 * A misread column produces confidently wrong savings advice, so a paste that
 * cannot be interpreted is rejected with a hint rather than partially accepted.
 */
export function UsagePasteBox({ onParsed, parsed }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<UsageParseError | null>(null)

  function handle(value: string) {
    setText(value)
    if (!value.trim()) {
      setError(null)
      onParsed(null)
      return
    }
    try {
      const result = parseUsagePaste(value)
      setError(null)
      onParsed(result)
    } catch (e) {
      setError(e instanceof UsageParseError ? e : new UsageParseError('Could not read that.'))
      onParsed(null)
    }
  }

  async function handleFile(file: File) {
    handle(await file.text())
  }

  return (
    <div className="bg-surface rounded-xl border border-white/10 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-light">2. Paste the results</h2>
        <p className="text-sm text-light/60 mt-1 max-w-2xl">
          Copy the results grid, or use Export to CSV and drop the file in. Both work.
        </p>
      </div>

      <div className="px-6 py-4 space-y-3">
        <label htmlFor="usage-paste" className="sr-only">Query results</label>
        <textarea
          id="usage-paste"
          value={text}
          onChange={e => handle(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={'TableName\tPlan\tTotalMB\tBillableMB\nCommonSecurityLog\tAnalytics\t1240000\t1240000\n…'}
          aria-invalid={error !== null}
          aria-describedby={error ? 'usage-paste-error' : undefined}
          className={`w-full bg-surface-raised border rounded-lg px-3 py-2 text-xs font-mono text-light placeholder:text-light/60 focus:outline-none focus:ring-2 resize-y ${
            error ? 'border-danger/60 focus:ring-danger' : 'border-white/15 focus:ring-primary'
          }`}
        />

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-white/15 text-light/80 hover:bg-white/10 hover:text-light transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-primary">
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            Upload CSV
          </label>
          {text && (
            <button
              type="button"
              onClick={() => handle('')}
              className="px-3 py-1.5 text-xs rounded-md border border-white/15 text-light/70 hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Clear
            </button>
          )}
        </div>

        <div role="status" aria-live="polite">
          {error && (
            <div id="usage-paste-error" className="rounded-lg px-4 py-3 bg-danger/15 border border-danger/40 text-sm">
              <p className="text-light font-medium">{error.message}</p>
              {error.hint && <p className="text-light/80 text-xs mt-1">{error.hint}</p>}
            </div>
          )}

          {parsed && !error && (
            <div className="rounded-lg px-4 py-3 bg-success/15 border border-success/40 text-sm">
              <p className="text-light">
                Read {parsed.rows.length} table{parsed.rows.length === 1 ? '' : 's'} —{' '}
                {parsed.totalBillableGbPerDay.toLocaleString('en-GB', { maximumFractionDigits: 1 })} GB/day
                billable over {parsed.lookbackDays} days.
              </p>
              {/* Protected tables return no data without an error, so a partially
                  permissioned user gets a silently truncated list. Only they can
                  tell whether the total looks right. */}
              <p className="text-light/80 text-xs mt-1">
                Does that total look right? If it seems low, some tables may be hidden from your
                account — compare it against Usage and estimated costs in the workspace.
              </p>
              {parsed.warnings.map(w => (
                <p key={w} className="text-light/80 text-xs mt-1">⚠ {w}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
