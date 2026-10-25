export const kOpenTourEvent = 'camnc-demo-tour-open';

/** Show the demo tour again from the start. */
export function openDemoTour() {
  window.dispatchEvent(new Event(kOpenTourEvent));
}
