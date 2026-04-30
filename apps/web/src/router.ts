// Tiny URL router. We avoid pulling in react-router for two reasons:
// the surface area we need is small (three routes, plain pushState), and
// we want a single source of truth for "what file is open" — encoding
// that in the URL is the simplest way to make it deep-linkable.
//
// Subpath deploys: when the app is mounted under a basePath (e.g.
// /design), all paths we hand to history.pushState must include that
// prefix, and incoming pathname strings must be normalized by stripping
// it before parseRoute matches against route segments. Without this,
// clicking into a project navigates to /projects/abc instead of
// /design/projects/abc, and refreshing 404s through nginx because the
// /design location block never sees a path it owns.

import { useEffect, useState } from 'react';
import { BASE_PATH } from './runtime/base-path';

export type Route =
  | { kind: 'home' }
  | { kind: 'project'; projectId: string; fileName: string | null };

function stripBasePath(pathname: string): string {
  if (!BASE_PATH) return pathname;
  if (pathname === BASE_PATH) return '/';
  if (pathname.startsWith(`${BASE_PATH}/`)) {
    return pathname.slice(BASE_PATH.length);
  }
  return pathname;
}

function withBasePath(routePath: string): string {
  if (!BASE_PATH) return routePath;
  // BASE_PATH never ends with '/'; routePath always starts with '/'.
  return routePath === '/' ? `${BASE_PATH}/` : `${BASE_PATH}${routePath}`;
}

export function parseRoute(pathname: string): Route {
  const stripped = stripBasePath(pathname);
  const parts = stripped.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { kind: 'home' };
  if (parts[0] === 'projects' && parts[1]) {
    const projectId = decodeURIComponent(parts[1]);
    if (parts[2] === 'files' && parts[3]) {
      return {
        kind: 'project',
        projectId,
        fileName: decodeURIComponent(parts.slice(3).join('/')),
      };
    }
    return { kind: 'project', projectId, fileName: null };
  }
  return { kind: 'home' };
}

export function buildPath(route: Route): string {
  if (route.kind === 'home') return withBasePath('/');
  const id = encodeURIComponent(route.projectId);
  if (route.fileName) {
    const file = route.fileName
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    return withBasePath(`/projects/${id}/files/${file}`);
  }
  return withBasePath(`/projects/${id}`);
}

// Centralized navigation. Components call this instead of mutating
// `window.location` directly so we can fan the change out to any
// `useRoute()` subscriber via a custom event.
export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const target = buildPath(route);
  const current = window.location.pathname;
  if (target === current) return;
  if (opts.replace) {
    window.history.replaceState(null, '', target);
  } else {
    window.history.pushState(null, '', target);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}
