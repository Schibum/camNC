import { isDemoMode } from '@/lib/demo/demo-mode';

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

function isLoopback(host: string) {
  return /^(localhost|127\.|\[?::1\]?)/.test(host);
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
