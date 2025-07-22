import { api } from '@convex-gen/api';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useRef } from 'react';
import superjson from 'superjson';

import type { ICamSource } from '@/store/store';
import { useStore } from '@/store/store';

export function ConvexCamSourceSync() {
  // Fetch initial value once.
  const remoteCamSource = useQuery(api.settings.getCamSource, {});
  const setRemoteCamSource = useMutation(api.settings.setCamSource);
  const addRow = useMutation(api.posts.add);

  const localCamSource = useStore(s => s.camSource);
  const setLocalCamSource = useStore(s => s.setCamSource);

  // Guard to ensure we only initialise once.
  const hasInitialised = useRef(false);

  // Initialise store from Convex on first load.
  useEffect(() => {
    if (hasInitialised.current) return;
    if (remoteCamSource === undefined || remoteCamSource === null) return;
    if (localCamSource) return; // already set from elsewhere

    try {
      const parsed = superjson.parse<ICamSource>(remoteCamSource as string);
      setLocalCamSource(parsed);
    } catch (e) {
      console.warn('Failed to parse camSource from Convex', e);
    }
    hasInitialised.current = true;
    // We intentionally omit dependencies to run at most once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteCamSource]);

  // Persist local changes to Convex.
  useEffect(() => {
    if (!localCamSource) return;
    const serialized = superjson.stringify(localCamSource);
    console.log('setting cam source', serialized);
    setRemoteCamSource({ camSource: serialized }).catch(err => console.error(err));
  }, [localCamSource, setRemoteCamSource]);

  return null;
}
