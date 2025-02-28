import { render } from 'preact';

import './style.css';
import { useEffect } from 'preact/hooks';
import { PulsingRectangle } from './PulsingRectangle';
import  ImageUnskew  from './unkskew';
import { UnskewThree } from './UnskewThree';
import { CssUnskewedImage } from './CssUnskew';


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
      {/* <PulsingRectangle/> */}
      {/* <ImageUnskew imageSrc="./present-toolpath/table.jpg"/> */}
      <UnskewThree imageUrl="./present-toolpath/table.jpg"/>
      <CssUnskewedImage imageUrl="./present-toolpath/table.jpg"/>
		</div>
	);
}



render(<App />, document.getElementById('app'));
