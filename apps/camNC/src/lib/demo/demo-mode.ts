/**
 * Demo mode: a preconfigured machine with a recorded camera and a simulated controller, so that
 * visitors can try camNC without any setup. It is decided once, when the app loads, from the
 * `/demo` URL (remembered in sessionStorage for reloads and navigation within the tab).
 *
 * Demo mode must never touch a real user's settings. The settings storage, the sync gate and the
 * settings API all check {@link isDemoMode}.
 */
import { detectDemoContext, kDemoFlag, kNoCameraFlag, kRehearsalFlag } from './demo-context';

const context =
  typeof location === 'undefined'
    ? { demo: false, rehearsalId: null, noCamera: false }
    : detectDemoContext(
        new URL(location.href),
        (() => {
          try {
            return sessionStorage;
          } catch {
            return null;
          }
        })()
      );
let demoMode = context.demo;
export const getRehearsalId = () => context.rehearsalId;

export function isDemoMode() {
  return demoMode;
}

/** Whether the demo runs without its camera, see {@link kNoCameraFlag}. */
export function isDemoWithoutCamera() {
  return context.noCamera;
}

/** Switch demo mode on or off without a page load. For tests. */
export function setDemoModeForTest(value: boolean) {
  demoMode = value;
}

/** Leave the demo and reload with the visitor's own settings, which the demo never touched. */
export function exitDemo(to = '/') {
  try {
    sessionStorage.removeItem(kRehearsalFlag);
    sessionStorage.removeItem(kDemoFlag);
    sessionStorage.removeItem(kNoCameraFlag);
  } catch {
    // Nothing to clear.
  }
  location.replace(to);
}

// A restored browser-history document keeps its old JS context. Do not let a cached normal page inherit a demo
// token, or revive a disposed rehearsal after returning to the source job.
if (typeof window !== 'undefined')
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    if (context.rehearsalId) return exitDemo('/cam?notice=rehearsal-expired');
    try {
      if (!demoMode && sessionStorage.getItem(kDemoFlag) === '1') {
        sessionStorage.removeItem(kDemoFlag);
        sessionStorage.removeItem(kRehearsalFlag);
        sessionStorage.removeItem(kNoCameraFlag);
        location.reload();
      }
    } catch {
      /* Context remains fixed for this document when storage is unavailable. */
    }
  });
