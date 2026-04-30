/**
 * UUID generator that works on plain HTTP.
 *
 * `crypto.randomUUID()` is restricted to secure contexts (HTTPS / localhost),
 * so on a plain-HTTP deployment like `http://<ip>/design` it is undefined and
 * the call site throws. `crypto.getRandomValues()`, however, is available in
 * insecure contexts — we use it to build an RFC 4122 v4 UUID by hand and only
 * fall back to `Math.random` if even that is missing (e.g. very old browsers).
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
