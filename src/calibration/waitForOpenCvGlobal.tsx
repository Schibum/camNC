// Function to wait for OpenCV.js to load
function waitForOpenCV() {
  return new Promise((resolve, reject) => {
    // Check if OpenCV is already loaded
    if ('cv' in window) {
      resolve(window.cv);
      return;
    }

    // Poll for window.cv to become available (it should be a promise)
    const intervalId = setInterval(() => {
      if ('cv' in window) {
        clearInterval(intervalId);
        // Assume window.cv is a promise that resolves to the API
        (window.cv as unknown as Promise<any>)
          .then((cv2: any) => {
            resolve(cv2);
          })
          .catch(reject);
      }
    }, 100);

    // Set a timeout to avoid waiting forever
    setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error('Timeout waiting for OpenCV.js to load'));
    }, 30000); // 30 second timeout
  });
}
export async function waitForOpenCvGlobal() {
  if ((window as any).cv.Mat) {
    return;
  }
  const cv = await waitForOpenCV();
  (window as any).cv = cv;
}
