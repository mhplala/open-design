/**
 * Single source of truth for the deployment base path.
 *
 * When the app is mounted at a subpath (e.g. `https://host/design`), every
 * absolute fetch in the client must be prefixed with that segment, and every
 * artifact iframe must carry a `<base href="...">` so the relative `/frames`,
 * `/artifacts`, etc. URLs the AI emits resolve under our prefix instead of
 * the host's root (which belongs to a different app on shared hosts).
 *
 * Set `NEXT_PUBLIC_OD_BASE_PATH=/design` at build time and Next.js will bake
 * the value into the bundle; leave unset for the standard root-mounted dev
 * and prod modes.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_OD_BASE_PATH ?? '';

/** Prepend the base path to an absolute API/asset path. */
export function apiUrl(path: string): string {
  return `${BASE_PATH}${path}`;
}

/** Trailing-slash form for `<base href>`. */
export const BASE_HREF = BASE_PATH ? `${BASE_PATH}/` : '/';
