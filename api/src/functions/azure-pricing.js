const { app } = require('@azure/functions')

app.http('azure-pricing', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'azure-pricing',
  handler: async (request) => {
    const url = new URL('https://prices.azure.com/api/retail/prices')

    // Forward all query parameters from the incoming request
    for (const [key, value] of request.query.entries()) {
      url.searchParams.set(key, value)
    }

    try {
      const response = await fetch(url.toString())
      if (!response.ok) {
        return { status: response.status, body: `Upstream error: ${response.status}` }
      }
      const data = await response.json()
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: data,
      }
    } catch (err) {
      return { status: 502, body: `Proxy error: ${err.message}` }
    }
  },
})
