import { afterEach, describe, expect, it } from 'vitest';
import { projectionOf, usePlan3dView } from './plan3dViewStore';

const kKey = 'camnc-plan-3d-view';
const initial = usePlan3dView.getInitialState();

afterEach(() => {
  usePlan3dView.setState(initial, true);
  localStorage.removeItem(kKey);
});

describe('3D Plan view settings', () => {
  it('starts in Result mode, 3D, perspective', () => {
    const s = usePlan3dView.getState();
    expect([s.mode, s.view, s.ortho3d, s.seeThrough, s.showRapids]).toEqual(['result', '3d', false, false, true]);
  });

  it('keeps the top view orthographic, and the 3D view in perspective unless switched', () => {
    expect(projectionOf('top', false)).toBe('orthographic');
    expect(projectionOf('top', true)).toBe('orthographic');
    expect(projectionOf('3d', false)).toBe('perspective');
    expect(projectionOf('3d', true)).toBe('orthographic');
  });

  it('remembers every toggle across reloads', async () => {
    const s = usePlan3dView.getState();
    s.setMode('compare');
    s.setSeeThrough(true);
    s.setView('top');
    s.setOrtho3d(true);
    s.setShowRapids(false);
    const saved = JSON.parse(localStorage.getItem(kKey)!);
    expect(saved).toEqual({
      state: { mode: 'compare', seeThrough: true, view: 'top', ortho3d: true, showRapids: false },
      version: 1,
    });

    // A fresh page: defaults first, then what was saved.
    usePlan3dView.setState(initial, true);
    expect(usePlan3dView.getState().mode).toBe('result');
    localStorage.setItem(kKey, JSON.stringify(saved));
    await usePlan3dView.persist.rehydrate();
    const r = usePlan3dView.getState();
    expect([r.mode, r.seeThrough, r.view, r.ortho3d, r.showRapids]).toEqual(['compare', true, 'top', true, false]);
  });

  it('carries over settings saved before Compare became a view', async () => {
    const v0 = (mode: string, compare: boolean, p3d: string) => ({
      state: { mode, seeThrough: false, view: '3d', projection: { top: 'perspective', '3d': p3d }, showRapids: true, compare },
      version: 0,
    });
    localStorage.setItem(kKey, JSON.stringify(v0('result', true, 'orthographic')));
    await usePlan3dView.persist.rehydrate();
    expect(usePlan3dView.getState()).toMatchObject({ mode: 'compare', ortho3d: true });
    expect(usePlan3dView.getState()).not.toHaveProperty('compare');

    // Compare left on in Toolpath (the toggle couldn't be reached there): just Toolpath.
    localStorage.setItem(kKey, JSON.stringify(v0('toolpath', true, 'perspective')));
    await usePlan3dView.persist.rehydrate();
    expect(usePlan3dView.getState()).toMatchObject({ mode: 'toolpath', ortho3d: false });
  });
});
