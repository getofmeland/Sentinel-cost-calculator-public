const { app } = require('@azure/functions')

// Frankfurter publishes ECB reference rates, needs no API key, and permits
// commercial use. Rates update once per working day, so a 24h cache is ample.
const UPSTREAM = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP,EUR'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

let cache = null // { body, fetchedAt }

app.http('fx-rates', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'fx-rates',
  handler: async (request, context) => {
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    }

    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return { status: 200, headers, jsonBody: cache.body }
    }

    let upstream
    try {
      upstream = await fetch(UPSTREAM)
    } catch (err) {
      context.log('FX upstream network error:', err)
      return { status: 502, headers, jsonBody: { error: 'Could not reach FX provider' } }
    }

    if (!upstream.ok) {
      context.log(`FX upstream error ${upstream.status}`)
      return { status: 502, headers, jsonBody: { error: `FX provider returned ${upstream.status}` } }
    }

    const data = await upstream.json()
    const gbp = data?.rates?.GBP
    const eur = data?.rates?.EUR

    // Reject a malformed or implausible response rather than letting it through
    // — a bad rate here silently rescales every figure in the calculator.
    const plausible = r => typeof r === 'number' && r > 0.1 && r < 5
    if (!plausible(gbp) || !plausible(eur)) {
      context.log('FX upstream returned implausible rates:', JSON.stringify(data?.rates))
      return { status: 502, headers, jsonBody: { error: 'FX provider returned unusable rates' } }
    }

    const body = { gbp, eur, date: data.date ?? null }
    cache = { body, fetchedAt: Date.now() }
    return { status: 200, headers, jsonBody: body }
  },
})
