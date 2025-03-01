import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';

import './style.css';
import { UnskewThree } from './UnskewThree';
import { CssUnskewedImage } from './CssUnskew';
import CameraSetup from './setup/CameraSetup';

function useMessageListener() {
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      // console.log('Message received:', event.data);
    };

    // Add the message event listener
    window.addEventListener('message', handleMessage);

    // Cleanup: Remove the event listener when the component unmounts
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);
}

export function App() {
  useMessageListener();
  return (
    <div>
      Hello web-uiiiiommmiikk
      <CameraSetup onSave={ev => console.log(ev)} initialUrl="http://hassio:1984/api/stream.mp4?src=cnccam&mp4=flac"/>
      {/* <CameraSetupKonva onSave={() => {}}/> */}
      {/* <PulsingRectangle/> */}
      {/* <ImageUnskew imageSrc="./present-toolpath/table.jpg"/> */}
      <UnskewThree imageUrl="./present-toolpath/table.jpg"/>
      <CssUnskewedImage imageUrl="./present-toolpath/table.jpg"/>

      Vid:
      {/* <video id="video"
           autoplay
           width="640"
           height="480"
           controls
           src="http://hassio:1984/api/stream.mp4?src=cnccam&mp4=flac"></video> */}
    </div>
  );
}

const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
