import { describe, it, expect } from 'vitest';
import {
  CamToMachineStep,
  MachineToCamStep,
  UndistortStep,
  generateCamToMachineMatrix,
  generateMachineToCamMatrix,
  type StepConfig,
  type VideoPipelineWorkerAPI,
} from './src';

describe('webgpu pipeline exports', () => {
  it('should expose pipeline classes', () => {
    expect(typeof CamToMachineStep).toBe('function');
    expect(typeof MachineToCamStep).toBe('function');
    expect(typeof UndistortStep).toBe('function');
  });
  it('should expose matrix helpers', () => {
    expect(typeof generateCamToMachineMatrix).toBe('function');
    expect(typeof generateMachineToCamMatrix).toBe('function');
  });
  it('should export worker types', () => {
    const dummyStep: StepConfig = { type: 'camToMachine', params: {} as any };
    expect(dummyStep).toBeTruthy();
    const fn = (api: VideoPipelineWorkerAPI) => api;
    expect(fn).toBeTruthy();
  });
});
