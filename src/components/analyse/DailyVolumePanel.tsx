import { useState } from 'react'
import { DAILY_VOLUME_QUERY } from '../../data/usageQuery'
import { parseDailyVolumePaste, type ParsedDailyVolume } from '../../utils/dailyVolumeParser'
import { UsageParseError } from '../../utils/usageParser'

interface Props {
  onParsed: (daily: ParsedDailyVolume | null) => void
  parsed: ParsedDailyVolume | null
}

/**
 * Optional step: daily volume, for a commitment tier sized against real
 * variation instead of a monthly average.
 *
 * Collapsed by default. The main flow works without it, and a second required
 * paste would cost more in abandonment than the accuracy is worth — but for
 * anyone sizing a commitment it is the difference between a defensible number
 * and an average that a single migration week can distort.
 */
export function DailyVolumePanel({ onParsed, parsed }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<UsageParseError | null>(null)
  const [copied, setCopied] = useState(false)

  function handle(value: string) {
    setText(value)
    if (!value.trim()) {
      setError(null)
      onParsed(null)
      return
    }
    try {
      onParsed(parseDailyVolumePaste(value))
      setError(null)
    } catch (e) {
      setError(e instanceof UsageParseError ? e : new UsageParseError('Could not read that.'))
      onParsed(null)
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-white/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full px-6 py-4 flex items-center justify-between gap-4 text-left hover:bg-white/5"
      >
        <span>
          <span className="text-sm font-medium text-light">
            Optional: size the commitment tier on your actual daily variation
          </span>
          <span className="block text-xs text-light/60 mt-0.5 max-w-2xl">
            {parsed && parsed.dayCount > 0
              ? `${parsed.dayCount} day${parsed.dayCount === 1 ? '' : 's'} of Analytics volume loaded. `
                + 'Whether the tier can be sized on them is stated with the recommendation.'
              : parsed
                ? 'No Analytics-plan volume found in that paste, so the tier is still sized on your average.'
                : 'A second short query. Without it the tier is sized on your monthly average, which '
                  + 'over-commits when a month contains a migration or a backfill.'}
          </span>
        </span>
        <span className="text-xs text-light/60 flex-shrink-0">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-6 pb-6 space-y-3 border-t border-white/10 pt-4">
          <p className="text-xs text-light/60 max-w-2xl">
            Overage above a commitment bills at that tier&rsquo;s own discounted rate, so committing
            a little low costs little — but a tier can only be lowered every 31 days, so committing
            high is locked in. That asymmetry is why the average is the wrong number to size on.
          </p>
          <div className="relative">
            <pre className="p-3 rounded-lg bg-black/30 border border-white/10 text-[11px] font-mono text-light/80 overflow-x-auto">
              {DAILY_VOLUME_QUERY}
            </pre>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(DAILY_VOLUME_QUERY)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="absolute top-2 right-2 text-[11px] px-2 py-1 rounded bg-white/10 text-light/80 hover:bg-white/20"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <textarea
            value={text}
            onChange={e => handle(e.target.value)}
            rows={5}
            spellCheck={false}
            aria-label="Daily volume query results"
            placeholder="Paste the daily volume results here"
            className="w-full p-3 rounded-lg bg-black/20 border border-white/10 text-xs font-mono text-light placeholder:text-light/60 focus:outline-none focus:border-primary"
          />
          {error && (
            <p className="text-xs text-accent-text">
              {error.message}{error.hint && <span className="text-light/70"> {error.hint}</span>}
            </p>
          )}
          {parsed?.warnings.map(w => (
            <p key={w} className="text-xs text-accent-text">{w}</p>
          ))}
          {/* dayCount can be zero on an all-Basic workspace, which parses fine.
              Math.min of an empty array is Infinity, so the guard is load-bearing. */}
          {parsed && !error && parsed.dayCount > 0 && (
            <p className="text-xs text-light/60">
              {parsed.dayCount} day{parsed.dayCount === 1 ? '' : 's'} read, ranging{' '}
              {Math.min(...parsed.analyticsGbByDay).toFixed(1)} to{' '}
              {Math.max(...parsed.analyticsGbByDay).toFixed(1)} GB/day on the Analytics plan.
            </p>
          )}
          {parsed && !error && parsed.dayCount === 0 && (
            <p className="text-xs text-accent-text">
              That paste contained no Analytics-plan volume, so it cannot size a commitment tier —
              tiers only ever cover Analytics volume.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
