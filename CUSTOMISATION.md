# Customisation Guide

Fork this repository and edit `src/config/brand.ts` to rebrand the calculator for your organisation.
That single file controls everything that changes between deployments.

## Brand config walkthrough

```typescript
const brand: BrandConfig = {
  name: 'My Company Cost Calculator',
  tagline: 'Microsoft Sentinel SIEM — Pricing Estimator',
  logoUrl: '/logo.svg',             // Optional: URL to your logo image
  websiteUrl: 'https://example.com', // Optional: wraps name/logo in a link

  colours: {
    primary:       '#a218ff', // Main interactive colour (buttons, fills, borders)
    accent:        '#ff2371', // Secondary highlights, badges, savings indicators
    primaryText:   '#bf6bff', // Small text in the primary colour — see note below
    accentText:    '#ff6b9b', // Small text in the accent colour — see note below
    navy:          '#001048', // Deep dark backgrounds
    dark:          '#191c26', // Page background, sticky bar background
    surface:       '#1e2130', // Card and panel backgrounds
    surfaceRaised: '#252838', // Nested panels, inputs, tab strips
    surfaceInset:  '#2e3245', // Toggle tracks, progress bars
    light:         '#f3f1ef', // Primary text colour
    warning:       '#ca792d', // Warning states, cached-pricing badge
    danger:        '#b4190e', // Error states
    success:       '#4d8965', // Success states (e.g. form submission)
  },

  defaults: {
    currency: 'GBP',      // 'GBP' | 'USD' | 'EUR' — shown on first load
    region: 'uksouth',    // Azure region ARM name — determines pricing fetched
  },

  featureRequests: {
    enabled: true,                          // false = hides the floating button entirely
    fallbackEmail: 'feedback@example.com',  // Shown in error states
  },
}
```

### Why there are separate `primaryText` and `accentText`

Saturated brand colours rarely have enough contrast against a dark surface to be
legible as small text. This project's own `primary` measures 3.13:1 and `accent`
4.36:1 against `surface` — both below the WCAG AA threshold of 4.5:1 for body
text. They are fine for backgrounds, borders, fills and large bold headings.

So the palette carries lighter tints used **only** for small text. When you
rebrand, check your two tints against your `surface` colour with any contrast
checker and lighten them until both clear 4.5:1. If you skip this, the app will
still work but will fail an accessibility audit on almost every figure it shows.

The same applies to translucent text: `text-light/40` and below fail AA on these
backgrounds, so anything conveying information uses `/60` or higher.

## Colour tips

- Keep `dark` and `surface` dark (close to black) — the UI is designed dark-first.
- `primary` is used for focus rings, active states, and recommended tier highlights. Ensure it
  contrasts against both `dark` and `surface` backgrounds (WCAG AA minimum 3:1 for large text,
  4.5:1 for body text).
- After editing colours in `brand.ts`, mirror the same values in `tailwind.config.js` so Tailwind
  utility classes (`text-primary`, `bg-accent`, etc.) stay in sync.

## Logo

If `logoUrl` is set, the text heading is replaced by the logo image. If both `logoUrl` and
`websiteUrl` are set, the logo links to your website. Place your logo in the `public/` folder
(e.g. `public/logo.svg`) and reference it as `/logo.svg`.

## Default currency and region

`defaults.currency` controls which currency is shown on first load (before the user changes it).
`defaults.region` sets the Azure region used for live pricing lookups on first load.

Valid region ARM names are listed in `src/services/azurePricing.ts`.

## Feature request setup

To enable the feature request form to actually create GitHub Issues:

1. Create a GitHub Personal Access Token with `repo` scope (or fine-grained token with Issues write).
2. Deploy to Azure Static Web Apps.
3. Add application settings:
   - `GITHUB_TOKEN` — your token
   - `GITHUB_OWNER` — your GitHub username or organisation
   - `GITHUB_REPO` — the repository name
4. Set `featureRequests.enabled: true` in `brand.ts`.

To disable the feature entirely (e.g. for an internal deployment), set `featureRequests.enabled: false`.

## What cannot be changed via brand.ts

- Pricing data — edit files in `src/data/`
- Calculation logic — edit files in `src/utils/`
- Log sources — edit `src/data/logSources.ts`
- The overall layout and component structure
