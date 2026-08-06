export interface BrandConfig {
  name: string;
  tagline?: string;
  logoUrl?: string;
  websiteUrl?: string;
  colours: {
    primary: string;
    accent: string;
    /**
     * Lighter tints of primary/accent, used only for small text.
     *
     * The saturated brand colours are below the WCAG AA 4.5:1 threshold against
     * the dark surface — primary measures 3.13:1 and accent 4.36:1 — so they are
     * fine for backgrounds, borders and icons but not for body-sized text.
     * If you rebrand, verify these two against your surface colour.
     */
    primaryText: string;
    accentText: string;
    navy: string;
    dark: string;
    surface: string;
    /** One step lighter than surface — nested panels, inputs, tab strips */
    surfaceRaised: string;
    /** Inset elements on a raised surface — toggle tracks, progress bars */
    surfaceInset: string;
    light: string;
    warning: string;
    danger: string;
    success: string;
  };
  defaults: {
    currency: 'GBP' | 'USD' | 'EUR';
    region: string;
  };
  featureRequests: {
    enabled: boolean;
    fallbackEmail?: string;
  };
}

const brand: BrandConfig = {
  name: 'Sentinel Cost Calculator',
  tagline: 'Microsoft Sentinel SIEM — Pricing Estimator',
  websiteUrl: 'https://www.cloudsecurityinsider.com',
  colours: {
    primary: '#a218ff',
    accent: '#ff2371',
    primaryText: '#bf6bff',   // 5.14:1 on surface, 5.47:1 on dark
    accentText: '#ff6b9b',    // 5.95:1 on surface, 6.34:1 on dark
    navy: '#001048',
    dark: '#191c26',
    surface: '#1e2130',
    surfaceRaised: '#252838',
    surfaceInset: '#2e3245',
    light: '#f3f1ef',
    warning: '#ca792d',
    danger: '#b4190e',
    success: '#4d8965',
  },
  defaults: {
    currency: 'GBP',
    region: 'uksouth',
  },
  featureRequests: {
    enabled: true,
    fallbackEmail: 'feedback@example.com',
  },
};

export default brand;
