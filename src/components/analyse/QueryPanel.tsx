import { useState } from 'react'
import {
  USAGE_QUERY,
  USAGE_QUERY_NOTES,
  USAGE_QUERY_LIMITATIONS,
  USAGE_LOOKBACK_DAYS,
} from '../../data/usageQuery'

/**
 * Step one of Analyse mode: the query to run, and the traps that would
 * otherwise silently corrupt the result.
 *
 * The warnings are not decoration. Without an explicit time range the portal
 * returns 24 hours instead of 31 days, and the user pastes a thirtieth of their
 * real volume with no error anywhere to tell them.
 */
export function QueryPanel() {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(USAGE_QUERY)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard is unavailable outside a secure context; the query is on
      // screen and selectable, so there is nothing to recover from.
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-white/10 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-light">
          1. Measure your ingestion
        </h2>
        <p className="text-sm text-light/60 mt-1 max-w-2xl">
          Run this in your Log Analytics workspace. It reports billable volume per table over the
          last {USAGE_LOOKBACK_DAYS} complete days. Nothing you paste back leaves your browser.
        </p>
      </div>

      <div className="px-6 py-4">
        <div className="relative">
          <pre className="bg-surface-raised border border-white/10 rounded-lg p-4 text-xs font-mono text-light/80 overflow-x-auto">
            <code>{USAGE_QUERY}</code>
          </pre>
          <button
            type="button"
            onClick={copy}
            className="absolute top-2 right-2 px-2.5 py-1 text-xs rounded-md border border-white/15 bg-surface text-light/80 hover:bg-white/10 hover:text-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <span role="status" aria-live="polite" className="sr-only">
          {copied ? 'Query copied to clipboard' : ''}
        </span>

        <div className="mt-4 space-y-3">
          {USAGE_QUERY_NOTES.map(note => (
            <div key={note.title} className="flex gap-2.5">
              <span aria-hidden="true" className="text-warning mt-0.5 flex-shrink-0">▸</span>
              <div>
                <p className="text-xs font-semibold text-light">{note.title}</p>
                <p className="text-xs text-light/60 mt-0.5">{note.body}</p>
              </div>
            </div>
          ))}
        </div>

        <details className="mt-4 group">
          <summary className="text-xs text-light/70 cursor-pointer hover:text-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">
            What this measurement cannot see
          </summary>
          <ul className="mt-2 space-y-1.5 pl-4">
            {USAGE_QUERY_LIMITATIONS.map(limit => (
              <li key={limit} className="text-xs text-light/60 list-disc">
                {limit}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  )
}
