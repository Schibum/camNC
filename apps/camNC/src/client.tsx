import { StartClient } from '@tanstack/react-start';
import { setKeepAliveTime } from '@wbcnc/go2webrtc/use-video-source';
import { hydrateRoot } from 'react-dom/client';
import { getCncApi } from './lib/fluidnc/machine';
import { createRouter } from './router';

// Connect to the configured machine early
getCncApi();
setKeepAliveTime(60_000);
const router = createRouter();

hydrateRoot(
  document,
  <>
    {/* <StrictMode> */}
    <StartClient router={router} />
    {/* </StrictMode> */}
  </>
);
