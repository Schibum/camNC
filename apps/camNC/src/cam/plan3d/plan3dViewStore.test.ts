import { afterEach, describe, expect, it } from 'vitest';
import { usePlan3dView } from './plan3dViewStore';

const kKey = 'camnc-plan-3d-view';
const initial = usePlan3dView.getInitialState();

afterEach(() => {
  usePlan3dView.setState(initial, true);
  localStorage.removeItem(kKey);
});

describe('3D Plan view settings', () => {
  it('starts in Result mode, 3D, perspective, with an orthographic top view', () => {
    const s = usePlan3dView.getState();
    expect([s.mode, s.view, s.seeThrough, s.showRapids]).toEqual(['result', '3d', false, true]);
    expect(s.projection).toEqual({ top: 'orthographic', '3d': 'perspective' });
  });

  it('sets the projection of the current view only', () => {
    const s = usePlan3dView.getState();
    s.setView('top');
    s.setProjection('perspective');
    expect(usePlan3dView.getState().projection).toEqual({ top: 'perspective', '3d': 'perspective' });
    s.setView('3d');
    s.setProjection('orthographic');
    expect(usePlan3dView.getState().projection).toEqual({ top: 'perspective', '3d': 'orthographic' });
  });

  it('remembers every toggle across reloads', async () => {
    const s = usePlan3dView.getState();
    s.setMode('toolpath');
    s.setSeeThrough(true);
    s.setView('top');
    s.setProjection('perspective');
    s.setShowRapids(false);
    const saved = JSON.parse(localStorage.getItem(kKey)!).state;
    expect(saved).toEqual({
      mode: 'toolpath',
      seeThrough: true,
      view: 'top',
      projection: { top: 'perspective', '3d': 'perspective' },
      showRapids: false,
      compare: false,
    });

    // A fresh page: defaults first, then what was saved.
    usePlan3dView.setState(initial, true);
    expect(usePlan3dView.getState().mode).toBe('result');
    localStorage.setItem(kKey, JSON.stringify({ state: saved, version: 0 }));
    await usePlan3dView.persist.rehydrate();
    const r = usePlan3dView.getState();
    expect([r.mode, r.seeThrough, r.view, r.showRapids]).toEqual(['toolpath', true, 'top', false]);
    expect(r.projection.top).toBe('perspective');
  });
});
