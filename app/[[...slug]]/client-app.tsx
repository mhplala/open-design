'use client';

import dynamic from 'next/dynamic';

const App = dynamic(() => import('../../src/App').then((m) => m.App), {
  ssr: false,
  loading: () => <div className="od-loading-shell">Loading Open Design…</div>,
});

export function ClientApp() {
  return <App />;
}
