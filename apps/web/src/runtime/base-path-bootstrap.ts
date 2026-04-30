'use client';

/**
 * Side-effect module: install a global fetch interceptor that prepends the
 * deployment BASE_PATH to absolute URLs targeting `/api`, `/artifacts`, or
 * `/frames`. Imported once at the top of the root layout so it runs before
 * any React component issues a fetch.
 *
 * Why monkey-patch instead of editing every fetch site:
 *   - 45+ call sites scattered across providers, state, and helpers.
 *   - Some (registry.ts:projectRawUrl, etc.) compose URLs that are then
 *     handed to <img>/<a> tags rather than fetch — the prefix has to apply
 *     to fetch only, but the same logic could be lifted into a helper later.
 *   - Easy to remove: when the app is deployed at the root, BASE_PATH is
 *     empty and the patch is a no-op.
 */
import { BASE_PATH } from './base-path';

declare global {
  interface Window {
    __odBasePathPatched?: boolean;
  }
}

if (typeof window !== 'undefined' && BASE_PATH) {
  installBasePathFetch();
}

function installBasePathFetch(): void {
  if (window.__odBasePathPatched) return;
  window.__odBasePathPatched = true;

  const PREFIX_RE = /^\/(api|artifacts|frames)(?:\/|$)/;
  const BASE = BASE_PATH;
  const origFetch: typeof fetch = window.fetch.bind(window);

  function rewritePath(pathname: string): string {
    if (pathname.startsWith(`${BASE}/`)) return pathname; // already prefixed
    if (!PREFIX_RE.test(pathname)) return pathname;
    return BASE + pathname;
  }

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (typeof input === 'string') {
      if (input.startsWith('/') && !input.startsWith('//')) {
        const rewritten = rewritePath(input);
        if (rewritten !== input) return origFetch(rewritten, init);
      }
      return origFetch(input, init);
    }
    if (input instanceof URL) {
      if (input.host === window.location.host) {
        const rewritten = rewritePath(input.pathname);
        if (rewritten !== input.pathname) {
          const next = new URL(input.toString());
          next.pathname = rewritten;
          return origFetch(next, init);
        }
      }
      return origFetch(input, init);
    }
    if (input instanceof Request) {
      try {
        const u = new URL(input.url, window.location.href);
        if (u.host === window.location.host) {
          const rewritten = rewritePath(u.pathname);
          if (rewritten !== u.pathname) {
            u.pathname = rewritten;
            return origFetch(new Request(u.toString(), input), init);
          }
        }
      } catch {
        // fall through to unmodified request on URL parse failure
      }
    }
    return origFetch(input, init);
  };
}
