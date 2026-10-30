/**
 * The camNC desktop app (`apps/camnc-desktop`) runs this same build in a Tauri webview. It is decided once, when the
 * app loads, from the bridge Tauri injects into the page.
 */
const desktopApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function isDesktopApp() {
  return desktopApp;
}

/** Where to get the desktop app: the installers of the latest release. */
export const kDesktopDownloadUrl = 'https://github.com/Schibum/camNC/releases/latest';
