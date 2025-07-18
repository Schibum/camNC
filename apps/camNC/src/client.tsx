import { StartClient } from '@tanstack/react-start';
import { setKeepAliveTime } from '@wbcnc/go2webrtc/use-video-source';
import { initFbApp } from '@wbcnc/public-config/firebase';
import { hydrateRoot } from 'react-dom/client';
import { getCncApi } from './lib/fluidnc/fluidnc-singleton';
import { createRouter } from './router';

import './store/firebaseSync';

initFbApp();
// Create connection early
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
