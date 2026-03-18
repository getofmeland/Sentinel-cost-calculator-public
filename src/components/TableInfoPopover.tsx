import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { SOURCE_TABLE_MAPPINGS, resolveWorkloadMappingId } from '../data/sentinelTables'

interface Props {
  /** Source ID from LOG_SOURCES, or a server workload ID (ws-* / lx-*) */
  sourceId: string
  /** Display name of the source — used as the popover heading */
  sourceName: string
}

const POPOVER_WIDTH = 340
const MAX_TABLES_COLLAPSED = 4

export function TableInfoPopover({ sourceId, sourceName }: Props) {
  const mappingId = resolveWorkloadMappingId(sourceId)
  const mapping = SOURCE_TABLE_MAPPINGS[mappingId]

  const [open, setOpen] = useState(false)
  const [showAllTables, setShowAllTables] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [flipUp, setFlipUp] = useState(false)

  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Compute position anchored to the info button
  const computePosition = useCallback(() => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    let left = rect.left
    // Clamp to viewport
    if (left + POPOVER_WIDTH > viewportW - 8) {
      left = Math.max(8, viewportW - POPOVER_WIDTH - 8)
    }

    // Show below by default; flip above if < 300px below button
    const spaceBelow = viewportH - rect.bottom
    const shouldFlip = spaceBelow < 300
    setFlipUp(shouldFlip)

    const top = shouldFlip
      ? rect.top - 8 // popover placed above using translateY(-100%)
      : rect.bottom + 6

    setPos({ top, left })
  }, [])

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      return
    }
    computePosition()
    setOpen(true)
    setShowAllTables(false)
    setCopied(false)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on Escape; reposition on scroll/resize
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    function handleResize() { computePosition() }
    document.addEventListener('keydown', handleKey)
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleResize, true)
    return () => {
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleResize, true)
    }
  }, [open, computePosition])

  async function handleCopy() {
    if (!mapping) return
    try {
      await navigator.clipboard.writeText(mapping.kqlExample)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable — silently ignore
    }
  }

  if (!mapping) return null

  const visibleTables = showAllTables
    ? mapping.tables
    : mapping.tables.slice(0, MAX_TABLES_COLLAPSED)
  const hiddenCount = mapping.tables.length - MAX_TABLES_COLLAPSED

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleOpen}
        aria-label={`Table reference for ${sourceName}`}
        aria-expanded={open}
        title="Show Sentinel tables"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold leading-none
          border border-teal-500/40 text-teal-400 hover:bg-teal-500/15 hover:border-teal-400
          transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400
          flex-shrink-0"
        style={{ color: '#00A3AD', borderColor: 'rgba(0,163,173,0.35)' }}
      >
        i
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-modal="false"
          aria-label={`Sentinel table reference — ${sourceName}`}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: POPOVER_WIDTH,
            transform: flipUp ? 'translateY(-100%)' : undefined,
            zIndex: 9999,
          }}
          className="bg-[#0D1117] border border-[#1E2D3D] rounded-xl shadow-2xl text-xs overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 pt-3 pb-2 border-b border-white/8">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-white text-[13px] leading-snug truncate">
                  {sourceName}
                </p>
                <p className="text-light/40 text-[10px] mt-0.5">
                  Connector: {mapping.connectorName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex-shrink-0 text-light/30 hover:text-light/70 transition-colors mt-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Tables */}
          <div className="px-4 pt-2.5 pb-1">
            <p className="text-[9px] font-semibold text-light/30 uppercase tracking-widest mb-1.5">
              Tables populated
            </p>
            <ul className="space-y-1.5">
              {visibleTables.map(table => (
                <li key={table.name} className="flex items-start gap-2">
                  <a
                    href={table.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[11px] font-medium whitespace-nowrap hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400 rounded"
                    style={{ color: '#00A3AD' }}
                  >
                    ↗ {table.name}
                  </a>
                  <span className="text-light/40 text-[10px] leading-relaxed">{table.description}</span>
                </li>
              ))}
            </ul>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllTables(v => !v)}
                className="mt-1.5 text-[10px] text-light/40 hover:text-light/70 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
              >
                {showAllTables ? '− Show fewer tables' : `+ ${hiddenCount} more table${hiddenCount === 1 ? '' : 's'}…`}
              </button>
            )}
          </div>

          {/* KQL Example */}
          <div className="mx-3 my-2 rounded-lg border border-white/8 bg-black/30 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/6">
              <span className="text-[9px] font-semibold text-light/30 uppercase tracking-widest">
                KQL example
              </span>
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy KQL example to clipboard"
                className="text-[10px] text-light/40 hover:text-light/80 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded px-1"
              >
                {copied ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>
            <pre className="px-3 py-2 font-mono text-[10px] text-light/60 overflow-x-auto whitespace-pre leading-relaxed">
              {mapping.kqlExample}
            </pre>
          </div>

          {/* Note */}
          {mapping.note && (
            <div className="mx-3 mb-2 flex items-start gap-2 px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: 'rgba(0,163,173,0.08)', border: '1px solid rgba(0,163,173,0.18)' }}>
              <span className="flex-shrink-0 text-[10px]" style={{ color: '#00A3AD' }}>ℹ</span>
              <p className="text-[10px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {mapping.note}
              </p>
            </div>
          )}

          {/* Connector docs link */}
          <div className="px-4 pb-3">
            <a
              href={mapping.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-light/40 hover:text-light/70 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            >
              📖 Connector documentation
            </a>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
