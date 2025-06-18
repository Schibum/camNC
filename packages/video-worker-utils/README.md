# Video Worker Utils

This package exposes WebGPU pipeline steps for remapping textures on-the-fly using a 3×3 transform matrix. Helper functions are provided to compute matrices for common use cases.

## Usage

```ts
import {
  CamToMachineStep,
  MachineToCamStep,
  UndistortStep,
  generateCamToMachineMatrix,
  generateMachineToCamMatrix,
} from '@wbcnc/video-worker-utils';
```

### Cam to Machine

```ts
const matrix = generateCamToMachineMatrix({ K, R, t });

const step = new CamToMachineStep(device, {
  outputSize: [width, height],
  machineBounds: [xmin, ymin, xmax, ymax],
  matrix,
});
```

### Machine to Cam

```ts
const matrix = generateMachineToCamMatrix({ K, R, t });

const step = new MachineToCamStep(device, {
  outputSize: [camWidth, camHeight],
  machineBounds: [xmin, ymin, xmax, ymax],
  matrix,
});
```

### Undistortion

Use `UndistortStep` with your calibration data:

```ts
const undistort = new UndistortStep(device, {
  outputSize: [width, height],
  cameraMatrix: K,
  newCameraMatrix: newK,
  distCoeffs,
});
```

You can chain steps together inside a `VideoPipelineWorker`:

```ts
const worker = new Worker(new URL('./videoPipeline.worker.ts', import.meta.url), { type: 'module' });
const proxy = Comlink.wrap<VideoPipelineWorkerAPI>(worker);
await proxy.init(stream, [
  { type: 'undistort', params: { outputSize: [width, height], cameraMatrix: K, newCameraMatrix: newK, distCoeffs } },
  { type: 'camToMachine', params: camToMachineParams },
]);
const bitmap = await proxy.process();
```
