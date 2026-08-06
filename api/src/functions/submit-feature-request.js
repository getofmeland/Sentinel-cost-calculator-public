const { app } = require('@azure/functions')

// Simple in-memory rate limiter: IP → { count, windowStart }
const rateLimitMap = new Map()
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60 * 60 * 1000 // 1 hour

const LABEL_MAP = {
  'Enhancement': 'enhancement',
  'Bug report': 'bug',
  'New log source': 'log-source',
  'Pricing update': 'pricing',
  'Data accuracy': 'data-update',
  'UI / usability': 'ui',
  'Calculation logic': 'calculation',
  'Other': 'enhancement',
}

const PRIORITY_MAP = {
  'Nice to have': 'nice-to-have',
  'Important': 'important',
  'Critical': 'critical',
}

app.http('submit-feature-request', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'submit-feature-request',
  handler: async (request, context) => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    }

    let body
    try {
      body = await request.json()
    } catch {
      return { status: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid JSON' }) }
    }

    const { name, email, category, summary, description, priority, website } = body

    // Honeypot check — silent success
    if (website) {
      return { status: 200, headers, body: JSON.stringify({ success: true }) }
    }

    const bad = message => ({
      status: 400, headers, body: JSON.stringify({ success: false, error: message }),
    })

    // Type-check before touching string methods. Truthiness alone let a
    // non-string through — a POST with "description": 123 passed both the
    // presence and length checks, then threw on .trim() and returned an
    // unhandled 500.
    const isString = v => typeof v === 'string'
    if (![name, email, summary, description].every(isString)) {
      return bad('Missing required fields.')
    }

    const trimmed = {
      name: name.trim(),
      email: email.trim(),
      summary: summary.trim(),
      description: description.trim(),
    }

    if (!trimmed.name || !trimmed.email || !trimmed.summary || !trimmed.description) {
      return bad('Missing required fields.')
    }

    // Server-side length caps mirroring the form's maxLength, which is trivially
    // bypassed by posting directly. Without these a single request could open a
    // 60,000-character issue.
    const LIMITS = { name: 100, email: 200, summary: 100, description: 2000 }
    for (const [field, max] of Object.entries(LIMITS)) {
      if (trimmed[field].length > max) {
        return bad(`${field.charAt(0).toUpperCase() + field.slice(1)} must be ${max} characters or fewer.`)
      }
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.email)) {
      return bad('Invalid email address.')
    }

    // Anti-spam: reject if description is too short or identical to summary
    if (trimmed.description.length < 20) {
      return bad('Description must be at least 20 characters.')
    }
    if (trimmed.description === trimmed.summary) {
      return bad('Description must differ from the summary.')
    }

    // Optional fields fall back to their defaults rather than being interpolated
    // into the issue body as [object Object] or similar.
    const safeCategory = isString(category) ? category.slice(0, 50) : 'Other'
    const safePriority = isString(priority) ? priority.slice(0, 50) : 'Nice to have'

    // Rate limiting by IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const now = Date.now()
    const record = rateLimitMap.get(ip) ?? { count: 0, windowStart: now }
    if (now - record.windowStart > RATE_WINDOW_MS) {
      record.count = 0
      record.windowStart = now
    }
    record.count++
    rateLimitMap.set(ip, record)
    if (record.count > RATE_LIMIT) {
      return { status: 429, headers, body: JSON.stringify({ success: false, error: 'Too many requests. Please try again later.' }) }
    }

    // GitHub API credentials
    const token = process.env.GITHUB_TOKEN
    const owner = process.env.GITHUB_OWNER
    const repo = process.env.GITHUB_REPO
    if (!token || !owner || !repo) {
      context.log('Missing GitHub environment variables')
      return { status: 500, headers, body: JSON.stringify({ success: false, error: 'Service not configured.' }) }
    }

    // Build issue
    const categoryLabel = LABEL_MAP[safeCategory] ?? 'enhancement'
    const priorityLabel = PRIORITY_MAP[safePriority] ?? 'nice-to-have'
    const issueTitle = trimmed.summary.slice(0, 100)
    const issueBody = [
      `**Submitted by:** ${trimmed.name} (${trimmed.email})`,
      `**Category:** ${safeCategory}`,
      `**Priority:** ${safePriority}`,
      '',
      '### Description',
      trimmed.description,
      '',
      `---`,
      `*Submitted via Sentinel Cost Calculator on ${new Date().toISOString()}*`,
    ].join('\n')

    let response
    try {
      response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          title: issueTitle,
          body: issueBody,
          labels: [categoryLabel, priorityLabel, 'user-submitted'],
        }),
      })
    } catch (err) {
      context.log('GitHub API network error:', err)
      return { status: 502, headers, body: JSON.stringify({ success: false, error: 'Could not reach GitHub. Please try again.' }) }
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      context.log(`GitHub API error ${response.status}:`, errText)
      return { status: 502, headers, body: JSON.stringify({ success: false, error: 'Failed to create issue. Please try again.' }) }
    }

    const issue = await response.json()
    return {
      status: 200,
      headers,
      body: JSON.stringify({
        success: true,
        issueUrl: issue.html_url,
        issueNumber: issue.number,
      }),
    }
  },
})
