const env = import.meta.env;

export const SITE = {
  dashboardUrl: env.PUBLIC_DASHBOARD_URL ?? 'http://localhost:5173',
  repoUrl: env.PUBLIC_REPO_URL ?? 'https://github.com/jamescollard/vastify-crm-storage',
  contactEmail: env.PUBLIC_CONTACT_EMAIL ?? 'hello@vastify.example',
  brandName: 'Vastify',
  tagline: 'Salesforce storage, offloaded. Onboarded by AI in 60 seconds.',
} as const;

export const NAV_LINKS = [
  { href: '/product',       label: 'Product' },
  { href: '/how-it-works',  label: 'How it works' },
  { href: '/ai',            label: 'AI' },
  { href: '/pricing',       label: 'Pricing' },
  { href: '/security',      label: 'Security' },
] as const;
