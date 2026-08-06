import { useState } from 'react'
import { encodeShareState, type ShareableState } from '../utils/shareState'

interface Props {
  state: ShareableState
  onExportCsv: () => void
  /** Disables both actions when there is nothing to share yet */
  isEmpty: boolean
}

/**
 * Copy a link, export a CSV, or print. Before this the only way to take an
 * estimate out of the tool was a screenshot, and a refresh discarded it.
 */
export function ShareBar({ state, onExportCsv, isEmpty }: Props) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  async function handleCopyLink() {
    const url = `${window.location.origin}${window.location.pathname}?${encodeShareState(state)}`
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(url)
      // Also put it in the address bar, so a plain browser bookmark captures
      // the estimate too.
      window.history.replaceState(null, '', url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard access is denied outside a secure context and in some
      // browsers. Update the address bar anyway so the link is still obtainable.
      window.history.replaceState(null, '', url)
      setCopyFailed(true)
      setTimeout(() => setCopyFailed(false), 5000)
    }
  }

  const buttonClass =
    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-white/15 ' +
    'text-light/80 hover:bg-white/10 hover:text-light transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
    'disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <button type="button" onClick={handleCopyLink} disabled={isEmpty} className={buttonClass}>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5" />
        </svg>
        Copy link
      </button>

      <button type="button" onClick={onExportCsv} disabled={isEmpty} className={buttonClass}>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
        </svg>
        Export CSV
      </button>

      <button type="button" onClick={() => window.print()} disabled={isEmpty} className={buttonClass}>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V4h12v5M6 18H4v-6h16v6h-2M8 14h8v6H8z" />
        </svg>
        Print / PDF
      </button>

      {/* Announced so the outcome is not conveyed by a visual change alone */}
      <span role="status" aria-live="polite" className="text-xs text-light/70">
        {copied && 'Link copied to clipboard'}
        {copyFailed && 'Clipboard unavailable — the link is now in your address bar'}
      </span>
    </div>
  )
}
