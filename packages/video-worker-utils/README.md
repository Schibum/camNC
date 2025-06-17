# Video Worker Utils

This package exposes WebGPU pipeline steps for remapping textures on-the-fly using a 3×3 transform matrix. Helper functions are provided to compute matrices for common use cases.

## Usage

```ts
import { CamToMachineStep, MachineToCamStep, generateCamToMachineMatrix, generateMachineToCamMatrix } from '@wbcnc/video-worker-utils';
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

For undistortion you can generate a suitable matrix and use a `CamToMachineStep`.
