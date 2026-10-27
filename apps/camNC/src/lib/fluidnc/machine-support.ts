import { isDemoMode } from '@/lib/demo/demo-mode';
import { normalizeHost } from '@wbcnc/fluidnc';

/** First Chrome/Edge version that applies Local Network Access to WebSockets (and lifts mixed content for them). */
export const kMinChromeVersion = 147;

export interface MachineSupport {
  supported: boolean;
  /** Human readable reason when unsupported */
  reason?: string;
}

interface UADataBrand {
  brand: string;
  version: string;
}

export function chromiumVersion(nav: Pick<Navigator, 'userAgent'> & { userAgentData?: { brands?: UADataBrand[] } }): number | null {
  const brands = nav.userAgentData?.brands;
  if (brands?.length) {
    const brand = brands.find(b => /Google Chrome|Microsoft Edge|Chromium/.test(b.brand));
    return brand ? Number(brand.version) : null;
  }
  const match = nav.userAgent.match(/(?:Chrome|Edg|Chromium)\/(\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * The machine connection needs a plain `ws://` socket to the controller. From the HTTPS app that only works
 * in Chrome/Edge 147+, where granting local network access also lifts mixed-content blocking. From a plain
 * HTTP origin (local dev server) any browser can open it.
 */
export function machineSupport(
  nav: Navigator & { userAgentData?: { brands?: UADataBrand[] } } = navigator,
  protocol = location.protocol
): MachineSupport {
  // The demo machine is simulated in the page, so it works in every browser.
  if (isDemoMode() || protocol === 'http:') return { supported: true };
  const version = chromiumVersion(nav);
  if (version === null) return { supported: false, reason: 'Machine control needs Chrome or Edge (version 147 or later).' };
  if (version < kMinChromeVersion) {
    return { supported: false, reason: `Machine control needs Chrome or Edge ${kMinChromeVersion} or later (you have ${version}).` };
  }
  return { supported: true };
}

function isPrivateIpv4(host: string) {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return false;
  const [a, b] = parts.map(Number) as [number, number];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function isPrivateIpv6(host: string) {
  if (!host.startsWith('[')) return false;
  const addr = host.slice(1, host.indexOf(']')).toLowerCase();
  return addr === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(addr) || /^fe[89ab][0-9a-f]?:/.test(addr);
}

/** Hostname part of what the user typed: no port, IPv6 keeps its brackets. */
function hostname(input: string) {
  const host = normalizeHost(input).toLowerCase();
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

/**
 * Chrome lifts mixed-content blocking for the controller's `ws://` socket only when it can tell from the host
 * itself that it is on the local network: a private IP address or a `.local` name. Any other name
 * (`fluidnc`, `fluidnc.fritz.box`) is blocked from the HTTPS app, even when it resolves to a LAN address.
 * Returns why the host cannot be used, or `null` when it can.
 */
export function hostBlockedReason(input: string, protocol = location.protocol): string | null {
  if (protocol !== 'https:' || isDemoMode()) return null;
  const host = hostname(input);
  if (!host) return null;
  if (host === 'localhost' || host.endsWith('.local') || isPrivateIpv4(host) || isPrivateIpv6(host)) return null;
  return `Chrome blocks "${host}" from the HTTPS app: only a local IP address (like 192.168.1.20) or a .local name is allowed. Enter the controller's IP address instead (shown on the FluidNC WebUI or in your router).`;
}

function isLoopback(host: string) {
  return /^(localhost|127\.|\[?::1\]?)/.test(host);
}

/** Whether this page itself is served from this computer (e.g. the dev server), which needs no local network permission. */
export function isLoopbackPage() {
  return typeof location !== 'undefined' && isLoopback(location.hostname);
}

/** Query Chrome's local/loopback network permission. Returns `null` where the browser has no such permission. */
export async function localNetworkPermission(host: string): Promise<PermissionState | null> {
  const names = isLoopback(host) ? ['loopback-network', 'local-network-access'] : ['local-network', 'local-network-access'];
  for (const name of names) {
    try {
      const status = await navigator.permissions.query({ name: name as PermissionName });
      return status.state;
    } catch {
      // Unknown permission name in this browser version.
    }
  }
  return null;
}
