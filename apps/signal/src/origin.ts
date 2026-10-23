/**
 * Matches an Origin header against a comma separated allow-list. Entries are
 * exact origins or patterns with `*` wildcards (e.g. `https://*.workers.dev`).
 * A single `*` allows every origin.
 */
export function isOriginAllowed(origin: string | null, allowList: string): boolean {
  // Non-browser clients send no Origin. The check only keeps other websites
  // from using the relay; it is not authentication.
  if (!origin) return true;
  return allowList
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .some(pattern => patternToRegExp(pattern).test(origin));
}

function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}
