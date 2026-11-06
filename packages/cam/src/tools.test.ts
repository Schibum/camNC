import { describe, expect, it } from 'vitest';
import { parseFusionToolLibrary, readFusionToolLibrary, selectToolPreset } from './tools';

// Same shape as Fusion's Local/Library.json, trimmed to the fields that matter.
const library = {
  version: 22,
  data: [
    {
      type: 'flat end mill',
      guid: 'g-1',
      unit: 'millimeters',
      description: '1/8 mill v1',
      geometry: { DC: 3.175, NOF: 1, LCF: 12 },
      'post-process': { number: 1 },
      'start-values': {
        presets: [{ v_f: 1800, v_f_plunge: 480, n: 15000, stepover: 1.27, 'use-stepover': true, stepdown: 9, 'use-stepdown': false }],
      },
    },
    { type: 'chamfer mill', unit: 'millimeters', description: 'engraver', geometry: { DC: 3.175 }, 'post-process': { number: 2 } },
    { type: 'holder', description: 'makita' },
    {
      type: 'flat end mill',
      unit: 'inches',
      description: '1/4 inch',
      geometry: { DC: 0.25, NOF: 2, LCF: 0.75 },
      'post-process': { number: 7 },
      'start-values': { presets: [{ v_f: 100, v_f_plunge: 20, n: 18000 }] },
    },
  ],
};

describe('Fusion tool library', () => {
  it('reads flat end mills with their feeds, in mm', () => {
    expect(parseFusionToolLibrary(JSON.stringify(library)).map(({ presets, presetId, presetName, ...tool }) => tool)).toEqual([
      // Stepover applies ("use-stepover"), the preset's stepdown doesn't.
      {
        number: 1,
        diameter: 3.175,
        name: '1/8 mill v1',
        guid: 'g-1',
        flutes: 1,
        fluteLength: 12,
        feed: 1800,
        plungeFeed: 480,
        rpm: 15000,
        stepover: 1.27,
      },
      { number: 7, diameter: 6.35, name: '1/4 inch', flutes: 2, fluteLength: 19.05, feed: 2540, plungeFeed: 508, rpm: 18000 },
    ]);
  });

  it('says what it skipped', () => {
    expect(readFusionToolLibrary(library).skipped).toEqual({ 'chamfer mill': 1 });
  });

  it('rejects other JSON', () => {
    expect(() => parseFusionToolLibrary('{"tools": []}')).toThrow(/Fusion tool library/);
  });
});

describe('cutting preset selection', () => {
  const choices = {
    data: [
      {
        type: 'flat end mill',
        guid: 'cutter-1',
        unit: 'inches',
        description: 'Router bit',
        geometry: { DC: 0.25, NOF: 2, LCF: 0.75 },
        'post-process': { number: 7 },
        'start-values': {
          presets: [
            {
              guid: 'rough-a',
              name: 'Rough',
              v_f: 100,
              v_f_plunge: 20,
              v_f_ramp: 30,
              v_f_leadIn: 40,
              v_f_leadOut: 50,
              v_f_transition: 80,
              v_f_reduced: 15,
              v_f_finish: 70,
              n: 18000,
              stepdown: 0.125,
              stepover: 0.1,
              'use-stepdown': true,
              'use-stepover': true,
              material: { category: 'wood', query: 'User test' },
            },
            { guid: 'light-b', name: 'Light', v_f: 60, n: 16000, stepdown: 0.05, 'use-stepdown': false },
          ],
        },
      },
    ],
  };

  it('retains every preset and preserves a selected preset when the library is re-imported', () => {
    const [tool] = parseFusionToolLibrary(choices, { selectedPresets: { 'cutter-1': 'light-b' } });
    expect(tool).toMatchObject({ presetId: 'light-b', presetName: 'Light', feed: 1524, rpm: 16000, flutes: 2, fluteLength: 19.05 });
    expect(tool.presets?.map(p => p.id)).toEqual(['rough-a', 'light-b']);
    expect(tool.presets?.[1]).toMatchObject({ stepdown: 1.27, useStepdown: false });
    expect(tool.stepdown).toBeUndefined();
    expect(tool.plungeFeed).toBeUndefined();
  });

  it('converts independent feeds without confusing them or replacing physical cutter data', () => {
    const [tool] = parseFusionToolLibrary(choices);
    expect(tool).toMatchObject({
      feed: 2540,
      plungeFeed: 508,
      rampFeed: 762,
      leadFeed: 1016,
      leadOutFeed: 1270,
      transitionFeed: 2032,
      reducedFeed: 381,
      finishFeed: 1778,
      stepdown: 3.175,
      stepover: 2.54,
    });
    const selected = selectToolPreset({ ...tool, stickout: 28 }, 'light-b');
    expect(selected).toMatchObject({ guid: 'cutter-1', number: 7, diameter: 6.35, fluteLength: 19.05, flutes: 2, stickout: 28 });
    for (const field of [
      'plungeFeed',
      'rampFeed',
      'leadFeed',
      'leadOutFeed',
      'reducedFeed',
      'finishFeed',
      'transitionFeed',
      'stepdown',
      'stepover',
    ] as const)
      expect(selected[field]).toBeUndefined();
    expect(selected.presets?.[0].material).toEqual({ category: 'wood', query: 'User test' });
  });

  it('rejects a missing or ambiguous preset instead of silently choosing different rates', () => {
    expect(() => parseFusionToolLibrary(choices, { selectedPresets: { 'cutter-1': 'missing' } })).toThrow(/no cutting preset/);
    const duplicated = structuredClone(choices);
    duplicated.data[0]['start-values'].presets[1].guid = 'rough-a';
    expect(() => parseFusionToolLibrary(duplicated)).toThrow(/unique/);
  });

  it('keeps unconfigured values absent without inferring material-qualified cutting rates', () => {
    const [tool] = parseFusionToolLibrary({
      data: [{ type: 'flat end mill', geometry: { DC: 3 }, 'start-values': { presets: [{ name: 'Unconfigured', v_f: 0, n: 0 }] } }],
    });
    expect(tool.feed).toBeUndefined();
    expect(tool.rpm).toBeUndefined();
    expect(tool.plungeFeed).toBeUndefined();
    expect(tool.presetId).toBe('index:0');
    expect(() =>
      parseFusionToolLibrary({ data: [{ type: 'flat end mill', geometry: { DC: 3 }, 'start-values': { presets: [{ v_f: -1 }] } }] })
    ).toThrow(/positive finite/);
  });
});
