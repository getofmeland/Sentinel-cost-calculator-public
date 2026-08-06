import { useEffect, useRef, useState } from 'react'
import brand from '../config/brand'
import { useFocusTrap } from '../utils/useFocusTrap'

interface Props {
  open: boolean
  onClose: () => void
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error'

const CATEGORIES = [
  'Enhancement',
  'Bug report',
  'New log source',
  'Pricing update',
  'Data accuracy',
  'UI / usability',
  'Calculation logic',
  'Other',
]

const PRIORITIES = ['Nice to have', 'Important', 'Critical'] as const

export function FeatureRequestModal({ open, onClose }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<typeof PRIORITIES[number]>('Nice to have')
  const [honeypot, setHoneypot] = useState('')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [issueUrl, setIssueUrl] = useState('')
  const [issueNumber, setIssueNumber] = useState<number | null>(null)

  const firstFieldRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Real focus trap: confines Tab to the dialog, handles Escape, and returns
  // focus to the button that opened it. The previous implementation set initial
  // focus only, so Tab escaped into the page behind the backdrop.
  const panelRef = useFocusTrap<HTMLDivElement>(open, onClose)

  // Auto-close on success
  useEffect(() => {
    if (submitState === 'success') {
      autoCloseTimer.current = setTimeout(() => onClose(), 5000)
    }
    return () => {
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current)
    }
  }, [submitState, onClose])

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setName(''); setEmail(''); setCategory(CATEGORIES[0])
        setSummary(''); setDescription(''); setPriority('Nice to have')
        setHoneypot(''); setSubmitState('idle'); setErrorMsg('')
        setIssueUrl(''); setIssueNumber(null)
      }, 300)
    }
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitState('submitting')
    setErrorMsg('')
    try {
      const res = await fetch('/api/submit-feature-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, category, summary, description, priority, website: honeypot }),
      })
      const data = await res.json()
      if (data.success) {
        setIssueUrl(data.issueUrl ?? '')
        setIssueNumber(data.issueNumber ?? null)
        setSubmitState('success')
      } else {
        setErrorMsg(data.error ?? 'Submission failed. Please try again.')
        setSubmitState('error')
      }
    } catch {
      setErrorMsg('Network error. Please try again.')
      setSubmitState('error')
    }
  }

  if (!open) return null

  const disabled = submitState === 'submitting'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feature-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative w-full max-w-lg bg-surface rounded-2xl shadow-2xl border border-white/10 overflow-hidden max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between flex-shrink-0">
          <h2 id="feature-modal-title" className="text-base font-semibold text-light">
            Suggest a feature
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-light/60 hover:text-light/80 transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 rounded"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {submitState === 'success' ? (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: `${brand.colours.success}22` }}>
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} style={{ color: brand.colours.success }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-light font-semibold text-base">Thanks for your suggestion!</p>
                {issueNumber && (
                  <p className="text-light/60 text-sm mt-1">Submitted as issue #{issueNumber}</p>
                )}
              </div>
              {issueUrl && (
                <a
                  href={issueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium transition-colors hover:opacity-80"
                  style={{ color: brand.colours.primary }}
                >
                  View on GitHub ↗
                </a>
              )}
              <p className="text-xs text-light/60">This window will close automatically in 5 seconds.</p>
            </div>
          ) : (
            <form id="feature-request-form" onSubmit={handleSubmit} className="space-y-4">
              {/* Honeypot — visually hidden */}
              <input
                type="text"
                name="website"
                value={honeypot}
                onChange={e => setHoneypot(e.target.value)}
                tabIndex={-1}
                aria-hidden="true"
                className="absolute opacity-0 pointer-events-none w-0 h-0"
                autoComplete="off"
              />

              {/* Name + Email */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="fr-name" className="block text-xs text-light/60 mb-1">Name <span aria-hidden="true">*</span></label>
                  <input
                    ref={firstFieldRef}
                    id="fr-name"
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    disabled={disabled}
                    className="w-full bg-white/5 border border-white/15 text-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label htmlFor="fr-email" className="block text-xs text-light/60 mb-1">Email <span aria-hidden="true">*</span></label>
                  <input
                    id="fr-email"
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    disabled={disabled}
                    className="w-full bg-white/5 border border-white/15 text-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label htmlFor="fr-category" className="block text-xs text-light/60 mb-1">Category</label>
                <select
                  id="fr-category"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  disabled={disabled}
                  className="w-full bg-white/5 border border-white/15 text-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                >
                  {CATEGORIES.map(c => <option key={c} value={c} className="bg-surface">{c}</option>)}
                </select>
              </div>

              {/* Summary */}
              <div>
                <label htmlFor="fr-summary" className="block text-xs text-light/60 mb-1">
                  Summary <span aria-hidden="true">*</span>
                  <span className="text-light/60 ml-1">({summary.length}/100)</span>
                </label>
                <input
                  id="fr-summary"
                  type="text"
                  required
                  maxLength={100}
                  value={summary}
                  onChange={e => setSummary(e.target.value)}
                  disabled={disabled}
                  className="w-full bg-white/5 border border-white/15 text-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  placeholder="One-line summary of your idea"
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="fr-description" className="block text-xs text-light/60 mb-1">
                  Description <span aria-hidden="true">*</span>
                  <span className="text-light/60 ml-1">({description.length}/2000, min 20)</span>
                </label>
                <textarea
                  id="fr-description"
                  required
                  minLength={20}
                  maxLength={2000}
                  rows={4}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  disabled={disabled}
                  className="w-full bg-white/5 border border-white/15 text-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 resize-none"
                  placeholder="Describe the problem you're trying to solve, or what you'd like to see…"
                />
              </div>

              {/* Priority */}
              <div>
                <span id="fr-priority-label" className="block text-xs text-light/60 mb-1.5">Priority</span>
                <div className="flex rounded-lg overflow-hidden border border-white/15" role="group" aria-labelledby="fr-priority-label">
                  {PRIORITIES.map(p => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={priority === p}
                      onClick={() => setPriority(p)}
                      disabled={disabled}
                      className={`flex-1 px-3 py-2 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                        priority === p
                          ? 'text-white font-semibold'
                          : 'text-light/50 hover:bg-white/5'
                      }`}
                      style={priority === p ? { background: brand.colours.primary } : {}}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Error state */}
              {submitState === 'error' && (
                <div className="rounded-lg px-4 py-3 bg-danger/10 border border-danger/30 text-sm text-light/80">
                  <p>{errorMsg}</p>
                  {brand.featureRequests.fallbackEmail && (
                    <p className="mt-1 text-xs text-light/50">
                      Or email us at{' '}
                      <a
                        href={`mailto:${brand.featureRequests.fallbackEmail}?subject=${encodeURIComponent(summary)}`}
                        className="underline hover:text-light/80"
                      >
                        {brand.featureRequests.fallbackEmail}
                      </a>
                    </p>
                  )}
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        {submitState !== 'success' && (
          <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-light/60 hover:text-light/90 transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="feature-request-form"
              disabled={disabled}
              className="px-5 py-2 text-sm font-medium text-white rounded-lg transition-opacity disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-white/40 flex items-center gap-2"
              style={{ background: brand.colours.primary }}
            >
              {submitState === 'submitting' ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Submitting…
                </>
              ) : 'Submit suggestion'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
