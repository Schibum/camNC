export const kDemoFlag = 'camnc-demo';
export const kNoCameraFlag = 'camnc-demo-no-camera';
export const kRehearsalFlag = 'camnc-rehearsal';
type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A keyless loopback build is a safe simulated preview, never an anonymous production session. */
export function shouldUseLocalPreviewDemo(url: URL, options: { publishableKey?: string; desktop: boolean }): boolean {
  return !options.desktop && !options.publishableKey?.trim() && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
}

export function isDemoChoiceUrl(url: URL): boolean {
  return (
    url.pathname === '/demo' &&
    url.searchParams.get('machine') !== '1' &&
    !url.searchParams.has('camera') &&
    !/^[a-f0-9-]{36}$/.test(url.searchParams.get('rehearsal') ?? '')
  );
}

/** Resolve the context before any store can hydrate. The bare /demo URL is the normal-mode choice page. */
export function detectDemoContext(url: URL, storage: TabStorage | null, options: { localPreview?: boolean } = {}) {
  const localPreview = options.localPreview ?? false;
  const onEntry = url.pathname === '/demo';
  const query = url.searchParams.get('rehearsal');
  const fromUrl = onEntry && query && /^[a-f0-9-]{36}$/.test(query) ? query : null;
  const camera = url.searchParams.get('camera');
  const machineEntry = onEntry && (url.searchParams.get('machine') === '1' || camera !== null || !!fromUrl);
  try {
    if (!storage) throw new Error('No tab storage');
    if (onEntry) {
      if (fromUrl) storage.setItem(kRehearsalFlag, fromUrl);
      else storage.removeItem(kRehearsalFlag);
      if (machineEntry) storage.setItem(kDemoFlag, '1');
      else storage.removeItem(kDemoFlag);
    }
    if (localPreview) {
      storage.setItem(kDemoFlag, '1');
      if (storage.getItem(kNoCameraFlag) === null) storage.setItem(kNoCameraFlag, '1');
    }
    const rehearsalId = storage.getItem(kRehearsalFlag);
    const demo = localPreview || !!rehearsalId || machineEntry || storage.getItem(kDemoFlag) === '1';
    if (demo && camera !== null) storage.setItem(kNoCameraFlag, camera === 'off' ? '1' : '0');
    return { demo, rehearsalId, noCamera: demo && (!!rehearsalId || storage.getItem(kNoCameraFlag) === '1') };
  } catch {
    // Explicit demo URLs still stay on simulated hardware even when storage is blocked.
    const demo = localPreview || machineEntry;
    return { demo, rehearsalId: fromUrl, noCamera: demo && (!!fromUrl || camera === 'off' || (localPreview && camera === null)) };
  }
}
