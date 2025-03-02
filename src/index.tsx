import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';

import './style.css';
import { VideoUnskew } from './VideoUnskew';
import { UnskewThree } from './UnskewThree';

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
      <VideoUnskew initialUrl="http://hassio:1984/api/stream.mp4?src=cnccam&mp4=flac"
      initialPoints={
        [
          [
              733.4787760416667,
              1160.5394042968749
          ],
          [
              1932.412109375,
              1070.939404296875
          ],
          [
              2158.545442708333,
              1664.0060709635416
          ],
          [
              797.4787760416666,
              1894.4060709635417
          ]
      ]

    }
      />
      {/* <UnskewThree videoUrl="http://hassio:1984/api/stream.mp4?src=cnccam&mp4=flac" imageSize={[2560, 1920]} srcPoints={[
        [
            840.1454427083332,
            210.23637695312502
        ],
        [
            1889.7454427083333,
            214.50304361979167
        ],
        [
            2474.278776041667,
            1319.5697102864583
        ],
        [
            703.612109375,
            1272.636376953125
        ]
      ]}/> */}
    </div>
  );
}

const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
