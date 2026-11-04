import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ModelImport } from './camTypes';
import type { CamJobV1 } from './jobDb';
import { kDefaultPlan } from './planSettings';
import { useJobBoards } from './useJobBoards';
import {
  boardHoldOf,
  boardRequest,
  holdLabel,
  holdSettingsOf,
  nestBoard,
  newBoard,
  partsHoldOf,
  resolveBoardRetention,
  retentionSettingsOf,
  type BoardV1,
  type PartInstance,
} from './boards';

const part: PartInstance = { id: 'part#0', partId: 'part', name: 'part', size: [100, 80, 18], thickness: 18 };
const board = () => newBoard([], 18, 'oak', [part.id], 'board');

describe('retention settings ownership', () => {
  it('new boards inherit job defaults, with independent board overrides and resets', () => {
    const original = board();
    const defaults = { retention: 'skin' as const, tapeAssisted: true, guidedRemoval: true };
    expect(original.retentionSettings).toEqual({});
    expect(retentionSettingsOf(original, defaults)).toEqual(defaults);
    expect(resolveBoardRetention(original, defaults)).toMatchObject({ holdDown: 'skin', boardHold: 'points' });

    const overridden = { ...original, retentionSettings: { retention: 'tabs' as const, tapeAssisted: false } };
    expect(retentionSettingsOf(overridden, defaults)).toEqual({ retention: 'tabs', tapeAssisted: false, guidedRemoval: true });
    expect(resolveBoardRetention(overridden, defaults).holdDown).toBe('tabs-guided');
    expect(resolveBoardRetention(overridden, { ...defaults, guidedRemoval: false }).holdDown).toBe('tabs');
    // Clearing just the retention override preserves the independent tape override.
    const reset = { ...overridden, retentionSettings: { tapeAssisted: false } };
    expect(retentionSettingsOf(reset, defaults)).toEqual({ ...defaults, tapeAssisted: false });
    expect(original.retentionSettings).toEqual({});
  });

  it('job defaults never alter legacy machining, including fixture/tape-only boards', () => {
    const defaults = { retention: 'tabs' as const, tapeAssisted: true, guidedRemoval: false };
    for (const holdDown of ['tabs', 'tabs-guided', 'skin', 'none', 'clamps', 'fixture-tape'] as const) {
      const legacy: BoardV1 = { ...board(), retentionSettings: undefined, holdDown };
      expect(resolveBoardRetention(legacy, defaults)).toBe(legacy);
      expect(retentionSettingsOf(legacy, defaults).tapeAssisted).toBe(false);
    }
    const fixture: BoardV1 = { ...board(), retentionSettings: undefined, holdDown: 'fixture-tape', boardHold: 'tape' };
    expect(boardHoldOf(resolveBoardRetention(fixture, defaults))).toBe('tape');
    expect(partsHoldOf(resolveBoardRetention(fixture, defaults))).toBe('fixture-tape');
    expect(nestBoard(fixture, [part], 6).holds).toEqual([]);
  });

  it('supplementary tape keeps tabs, mechanical holds, tab spacing and per-part exceptions', () => {
    const source = { ...board(), tabFallbacks: { [part.id]: 'self' as const }, measuredThickness: 18.24 };
    const plain = resolveBoardRetention(source);
    const assisted = resolveBoardRetention(source, { tapeAssisted: true });
    const plainNest = nestBoard(plain, [part], 6);
    const assistedNest = nestBoard(assisted, [part], 6);
    expect(assisted.holdDown).toBe('tabs');
    expect(boardHoldOf(assisted)).toBe('points');
    expect(assistedNest).toEqual(plainNest);
    expect(assistedNest.holds.length).toBeGreaterThan(0);
    const request = boardRequest(assisted, assistedNest, [part], { tapeAssisted: true });
    expect(request.holdDown).toBe('tabs');
    expect(request.tapeAssisted).toBe(true);
    expect(request.holdPoints).toEqual(assistedNest.holds);
    expect(request.parts[0].tabFallback).toBe('self');
    expect(request.stockTop).toBe(18.24);
    expect(holdLabel(assisted, { tapeAssisted: true })).toContain('tape-assisted');
  });

  it('copying hold settings copies ownership without sharing mutable overrides', () => {
    const source = { ...board(), retentionSettings: { retention: 'none' as const, tapeAssisted: true } };
    const copy = holdSettingsOf(source);
    expect(copy.retentionSettings).toEqual(source.retentionSettings);
    expect(copy.retentionSettings).not.toBe(source.retentionSettings);
    const legacy = { ...source, retentionSettings: undefined, holdDown: 'tabs-guided' as const };
    const target = { ...source, ...holdSettingsOf(legacy) };
    expect(target.retentionSettings).toBeUndefined();
    expect(resolveBoardRetention(target, { retention: 'skin' })).toBe(target);
  });

  it('resolves defaults before nesting and planning without a board-persistence loop', () => {
    const model: ModelImport = {
      parts: [
        {
          id: part.partId,
          name: part.name,
          names: [part.name],
          size: part.size,
          thickness: part.thickness,
          shape: { outlines: [], holes: [], pockets: [] },
          summary: {
            chips: [],
            needsFlip: false,
            bottomDepths: [],
            notFlat: false,
            prismaticRatio: 1,
            slopedShare: 0,
            slopedArea: 0,
            smallestInsideRadius: null,
          },
        },
      ],
      meshes: [],
      readMs: 0,
      analyzeMs: 0,
    };
    const job: CamJobV1 = {
      v: 1,
      id: 'job',
      name: 'job',
      fileName: 'job.step',
      createdAt: 1,
      updatedAt: 1,
      parts: [],
      plan: { ...kDefaultPlan, retentionDefaults: { retention: 'skin', tapeAssisted: true } },
    };
    const hook = renderHook(({ job }) => useJobBoards(job, model), { initialProps: { job } });
    expect(hook.result.current.changed).toBe(true);
    const inherited = hook.result.current.boards[0];
    expect(inherited.request.holdDown).toBe('skin');
    expect(inherited.request.tapeAssisted).toBe(true);
    expect(inherited.nest.gap).toBe(8);

    const saved = { ...job, boards: [{ ...inherited.board, measuredThickness: 18.24 }] };
    hook.rerender({ job: saved });
    expect(hook.result.current.changed).toBe(false);
    hook.rerender({ job: { ...saved, plan: { ...kDefaultPlan, retentionDefaults: { retention: 'tabs', guidedRemoval: true } } } });
    const changed = hook.result.current.boards[0];
    expect(hook.result.current.changed).toBe(false);
    expect(changed.request.holdDown).toBe('tabs-guided');
    expect(changed.request.tapeAssisted).toBeUndefined();
    expect(changed.request.stockTop).toBe(18.24);
    expect(changed.nest.gap).toBeGreaterThan(inherited.nest.gap);
    expect(saved.boards[0].retentionSettings).toEqual({});
    hook.unmount();
  });
});
