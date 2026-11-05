import type { StateStorage } from 'zustand/middleware';
import { isDemoMode } from './demo-mode';

// A demo page starts empty and loses its edits on reload. In particular, CAM's independent stores must not hydrate
// real bits, cutting data or a real machine queue just because the main settings store is already isolated.
const memory = new Map<string, string>();
export const demoStorage: StateStorage = {
  getItem: name => (isDemoMode() ? (memory.get(name) ?? null) : localStorage.getItem(name)),
  setItem: (name, value) => {
    if (isDemoMode()) memory.set(name, value);
    else localStorage.setItem(name, value);
  },
  removeItem: name => {
    if (isDemoMode()) memory.delete(name);
    else localStorage.removeItem(name);
  },
};
