import { useEffect, useState } from 'react';

/** Below this the top bar doesn't fit beside the open panel and the machine panel: it opens over the page instead. */
const kFullPanelQuery = '(min-width: 1440px)';

export function useRoomForFullPanel() {
  const [room, setRoom] = useState(() => window.matchMedia(kFullPanelQuery).matches);
  useEffect(() => {
    const media = window.matchMedia(kFullPanelQuery);
    const onChange = () => setRoom(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return room;
}
