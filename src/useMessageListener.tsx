import { useEffect } from 'react';

// This is a custom hook that might be used in components

export function useMessageListener() {
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      console.log('Message received:', event.data);
      if (event.origin !== window.location.origin) {
        return;
      }
    };

    // Add the message event listener
    window.addEventListener('message', handleMessage);

    // Cleanup: Remove the event listener when the component unmounts
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);
}
