import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { I18nProvider } from '../src/i18n';
import '../src/index.css';

export const metadata: Metadata = {
  title: 'Open Design',
  icons: {
    icon: '/logo.svg',
    // Safari pinned-tab mask icon — Next.js's Metadata API doesn't have a
    // dedicated `mask` field, so we surface it via the generic `other`
    // bucket which renders as a raw <link rel="mask-icon" ...>.
    other: [{ rel: 'mask-icon', url: '/logo.svg', color: '#1F1B16' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#F4EFE6',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // `suppressHydrationWarning` only on <html> and <body>: browser
  // extensions (Sogapaper, wallet extensions like MetaMask / Phantom,
  // password managers, etc.) routinely inject attributes onto the
  // root document elements before React can hydrate, which trips
  // React's hydration-mismatch warning even though our render is
  // pristine. The flag is scoped to these two elements only — actual
  // mismatches deeper in the tree still warn normally. This is the
  // approach Next.js itself recommends.
  return (
    <html lang='en' suppressHydrationWarning>
      <body suppressHydrationWarning>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
