import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Confine keyboard focus to a container while it is open, and hand focus back
 * to whatever opened it on close.
 *
 * Both the feature-request modal and the table popover previously claimed a
 * focus trap they did not have: Tab walked straight out into the page behind
 * the backdrop, and closing left focus on <body> rather than the trigger. The
 * popover was worse, being portalled to the end of <body>, so its content sat
 * nowhere near the trigger in the tab order.
 *
 * @param active whether the container is currently open
 * @param onEscape optional handler for the Escape key
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  // Mutable so a caller can share one DOM node between this and another ref.
  const containerRef = useRef<T | null>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) return

    previouslyFocused.current = document.activeElement as HTMLElement | null

    const container = containerRef.current
    const focusable = () =>
      Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
        .filter(el => el.offsetParent !== null || el === document.activeElement)

    // Focus the first control rather than leaving focus outside the container.
    focusable()[0]?.focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onEscape?.()
        return
      }
      if (e.key !== 'Tab') return

      const items = focusable()
      if (items.length === 0) {
        // Nothing focusable inside: keep focus from escaping anyway.
        e.preventDefault()
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement as HTMLElement | null

      // Wrap at both ends, and pull focus back in if it has already escaped.
      if (e.shiftKey && (current === first || !container?.contains(current))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (current === last || !container?.contains(current))) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // Restore focus to the trigger so keyboard users are not dropped on <body>.
      previouslyFocused.current?.focus?.()
    }
  }, [active, onEscape])

  return containerRef
}
