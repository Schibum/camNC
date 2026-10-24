/**
 * Demo mode: a preconfigured machine with a recorded camera and a simulated controller, so that
 * visitors can try camNC without any setup. It is decided once, when the app loads, from the
 * `/demo` URL (remembered in sessionStorage for reloads and navigation within the tab).
 *
 * Demo mode must never touch a real user's settings. The settings storage, the sync gate and the
 * settings API all check {@link isDemoMode}.
 */
const kDemoFlag = 'camnc-demo';

function detect(): boolean {
  if (typeof location === 'undefined') return false;
  const onDemoPath = location.pathname === '/demo' || location.pathname.startsWith('/demo/');
  try {
    if (onDemoPath) sessionStorage.setItem(kDemoFlag, '1');
    return onDemoPath || sessionStorage.getItem(kDemoFlag) === '1';
  } catch {
    // Blocked storage: stay in demo mode for this page load only.
    return onDemoPath;
  }
}

let demoMode = detect();

export function isDemoMode() {
  return demoMode;
}

/** Switch demo mode on or off without a page load. For tests. */
export function setDemoModeForTest(value: boolean) {
  demoMode = value;
}

/** Leave the demo and reload with the visitor's own settings, which the demo never touched. */
export function exitDemo(to = '/') {
  try {
    sessionStorage.removeItem(kDemoFlag);
  } catch {
    // Nothing to clear.
  }
  location.assign(to);
}
