import { describe, expect, it } from 'vitest';
import { machiningCases } from '../test/machining-fixtures';
import { machiningRecord, planFingerprint, setupSheet, summarizeSetup } from './setupSummary';
import { camPart } from './toolpaths';
import { postProgram, toGcode } from './gcode';

describe('machine setup evidence', () => {
  it('returns the same posted plan and setup without changing the source plan', () => {
    const cam = camPart(machiningCases.rectangle(), { cutThrough: false });
    const source = structuredClone(cam);
    const posted = postProgram(cam, { partName: 'Fixture', safeZ: 20, retractZ: 16 });
    expect(posted.gcode).toBe(toGcode(cam, { partName: 'Fixture', safeZ: 20, retractZ: 16 }));
    expect(posted.gcode).toContain(`(Plan: ${posted.setup.planFingerprint})`);
    expect(posted.setup).toMatchObject({ safeZ: 20, retractZ: 16, post: { profileId: 'fluidnc', arcs: true } });
    expect(postProgram(cam, { arcs: false }).setup.planFingerprint).not.toBe(posted.setup.planFingerprint);
    expect(cam).toEqual(source);
  });
  it('uses the planned datum, actual clearance heights and mounted tool measurements', () => {
    const cam = camPart(machiningCases.rectangle(), {
      safeHeight: 8,
      retractHeight: 4,
      tools: [{ number: 2, diameter: 3.175, fluteLength: 20, stickout: 25, rpm: 18000 }],
    });
    const summary = summarizeSetup(cam, { programName: 'Pocket', stockSize: [100, 70, 12] });
    expect(summary.origin).toEqual({ xy: 'stock lower left', z: 'stock bottom' });
    expect(summary).toMatchObject({ safeZ: 20, retractZ: 16 });
    expect(summary.tools[0]).toMatchObject({ rpm: 18000, maximumCutDepth: 12.3, tool: { number: 2, stickout: 25 } });
    expect(setupSheet(summary)).toContain('Z0: stock bottom');
    expect(setupSheet(summary)).toContain('Re-zero Z after changing a physical tool');
  });

  it('fingerprints cutting changes while ignoring object insertion order', () => {
    const cam = camPart(machiningCases.rectangle());
    expect(planFingerprint(cam)).toBe(planFingerprint(Object.fromEntries(Object.entries(cam).reverse()) as unknown as typeof cam));
    const changed = structuredClone(cam);
    changed.operations[0].passes[0].feeds[0] += 1;
    expect(planFingerprint(changed)).not.toBe(planFingerprint(cam));
    expect(summarizeSetup({ stockTop: 12, operations: [], warnings: ['No reachable cut'] }).bounds).toBeNull();
  });

  it('identifies a feature datum when the declared blank surrounds XY zero', () => {
    const cam = camPart(machiningCases.rectangle(), { cutThrough: false });
    cam.stockFootprint = [
      [
        { x: -5, y: -5 },
        { x: 105, y: -5 },
        { x: 105, y: 75 },
        { x: -5, y: 75 },
      ],
    ];
    const posted = postProgram(cam);
    expect(posted.setup.origin.xy).toBe('feature frame');
    expect(posted.gcode).toContain('X0 Y0 = programmed feature-frame origin');
    expect(setupSheet(posted.setup)).toContain('XY0: programmed feature frame');
  });

  it('retains measurements against an exact plan without inferring qualification', () => {
    const setup = summarizeSetup(camPart(machiningCases.rectangle()));
    const details = {
      machine: { id: 'router-1', controllerVersion: '4.1.1', configurationFingerprint: 'configuration-1' },
      material: { name: 'plywood', measuredThickness: 12.2 },
      recordedAt: '2026-11-06T12:00:00Z',
      observation: { kind: 'planned' as const, notes: 'Awaiting physical measurements' },
    };
    const record = machiningRecord(setup, details);
    expect(record.schemaVersion).toBe(1);
    expect(record.setup.planFingerprint).toBe(setup.planFingerprint);
    record.setup.tools[0].tool.diameter = 10;
    expect(setup.tools[0].tool.diameter).toBe(3.175);
    expect(() => machiningRecord(setup, { ...details, material: { name: 'plywood', measuredThickness: NaN } })).toThrow(/thickness/);
    const observed = machiningRecord(setup, {
      ...details,
      material: { ...details.material, batch: 'sheet-1', moisturePercent: 9.5 },
      attachments: [{ label: 'Corner finish', uri: 'measurements/corner.jpg' }],
      observation: { kind: 'cut', cuttingSeconds: 95, dimensionalErrorsMm: [0.02, -0.01], chatter: false },
    });
    expect(observed.material.moisturePercent).toBe(9.5);
    expect(observed.attachments![0].uri).toBe('measurements/corner.jpg');
    expect(() => machiningRecord(setup, { ...details, material: { ...details.material, moisturePercent: 101 } })).toThrow(/moisture/);
  });
});
