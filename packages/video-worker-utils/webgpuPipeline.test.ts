import { describe, it, expect } from 'vitest';
import { CamToMachineStep, MachineToCamStep, generateCamToMachineMatrix, generateMachineToCamMatrix } from './src';

describe('webgpu pipeline exports', () => {
  it('should expose pipeline classes', () => {
    expect(typeof CamToMachineStep).toBe('function');
    expect(typeof MachineToCamStep).toBe('function');
  });
  it('should expose matrix helpers', () => {
    expect(typeof generateCamToMachineMatrix).toBe('function');
    expect(typeof generateMachineToCamMatrix).toBe('function');
  });
});
