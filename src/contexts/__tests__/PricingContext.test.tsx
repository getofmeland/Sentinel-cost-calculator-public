/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PricingProvider, usePricing } from '../PricingContext'
import {
  FAILURE_CACHE_TTL_MS,
  REGIONAL_RATE_RETRY_NOTE,
  REGIONAL_RATE_UNPUBLISHED_NOTE,
  clearRegionCache,
} from '../../services/azurePricing'

function Probe() {
  const { defenderIsocRateNote } = usePricing()
  return <p>{defenderIsocRateNote ?? 'none'}</p>
}

function priceResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

describe('PricingProvider schedules one ISOC refetch', () => {
  let root: Root | undefined
  let container: HTMLDivElement

  beforeEach(() => {
    const globals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    globals.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => { root?.unmount() })
    container?.remove()
    clearRegionCache('uksouth')
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('refetches a successful empty ISOC list, then says the region has no published meter', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = decodeURIComponent(String(input))
      if (url.includes('Microsoft Defender ISOC')) return priceResponse({ Items: [] })
      if (url.includes('Log Analytics')) {
        return priceResponse({
          Items: [{
            meterName: 'Analytics Logs Data Retention',
            retailPrice: 0.13,
            unitOfMeasure: '1 GB/Month',
            armRegionName: 'uksouth',
            productName: 'Log Analytics',
          }],
        })
      }
      if (url.includes('Sentinel')) {
        return priceResponse({
          Items: [{
            meterName: 'Pay-as-you-go Analysis',
            retailPrice: 5.38,
            unitOfMeasure: '1 GB',
            armRegionName: 'uksouth',
            productName: 'Sentinel',
          }],
        })
      }
      return { ok: true, json: async () => ({ gbp: 0.75, eur: 0.86 }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container)
      root.render(<PricingProvider><Probe /></PricingProvider>)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).toContain(REGIONAL_RATE_RETRY_NOTE)
    const callsAfterFirst = fetchMock.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAILURE_CACHE_TTL_MS)
    })

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst)
    expect(container.textContent).toContain(REGIONAL_RATE_UNPUBLISHED_NOTE)
  })
})
