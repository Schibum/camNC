import { afterEach, describe, expect, it } from 'vitest';
import { usePlanLayout } from './planLayoutStore';

const kKey = 'camnc-plan-layout';
const initial = usePlanLayout.getInitialState();

afterEach(() => {
  usePlanLayout.setState(initial, true);
  localStorage.removeItem(kKey);
});

describe('Plan sidebar layout', () => {
  it('starts on the operations, as a list', () => {
    const s = usePlanLayout.getState();
    expect([s.tab, s.opsView]).toEqual(['operations', 'list']);
  });

  it('remembers the tab and the list or table across reloads', async () => {
    usePlanLayout.getState().setTab('settings');
    usePlanLayout.getState().setOpsView('table');
    const saved = JSON.parse(localStorage.getItem(kKey)!).state;
    expect(saved).toEqual({ tab: 'settings', opsView: 'table' });

    // A fresh page: defaults first, then what was saved.
    usePlanLayout.setState(initial, true);
    expect(usePlanLayout.getState().tab).toBe('operations');
    localStorage.setItem(kKey, JSON.stringify({ state: saved, version: 0 }));
    await usePlanLayout.persist.rehydrate();
    const r = usePlanLayout.getState();
    expect([r.tab, r.opsView]).toEqual(['settings', 'table']);
  });
});
