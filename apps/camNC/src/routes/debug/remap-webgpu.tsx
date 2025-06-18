import { CamToMachineStep, MachineToCamStep, generateCamToMachineMatrix, generateMachineToCamMatrix } from '@wbcnc/video-worker-utils';
import { createFileRoute } from '@tanstack/react-router';
import { useCameraExtrinsics, useNewCameraMatrix, useCamResolution, useVideoUrl, useStore } from '@/store/store';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { useEffect, useRef, useState } from 'react';

export const Route = createFileRoute('/debug/remap-webgpu')({
  component: RouteComponent,
});

function present(device: GPUDevice, texture: GPUTexture, ctx: GPUCanvasContext, width: number, height: number) {
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToTexture({ texture }, { texture: ctx.getCurrentTexture() }, [width, height]);
  device.queue.submit([encoder.finish()]);
}

function RouteComponent() {
  const videoUrl = useVideoUrl();
  const camRes = useCamResolution();
  const K = useNewCameraMatrix();
  const { R, t } = useCameraExtrinsics();
  const bounds = useStore(state => state.camSource!.machineBounds!);

  const videoRef = useRef<HTMLVideoElement>(null);
  const camToMachineCanvas = useRef<HTMLCanvasElement>(null);
  const backCanvas = useRef<HTMLCanvasElement>(null);

  const [device, setDevice] = useState<GPUDevice | null>(null);

  useEffect(() => {
    if (!navigator.gpu) return;
    navigator.gpu.requestAdapter().then(ad => ad?.requestDevice().then(setDevice));
  }, []);

  useEffect(() => {
    if (!device || !videoRef.current || !camToMachineCanvas.current || !backCanvas.current) return;

    const ctx1 = camToMachineCanvas.current.getContext('webgpu') as GPUCanvasContext | null;
    const ctx2 = backCanvas.current.getContext('webgpu') as GPUCanvasContext | null;
    if (!ctx1 || !ctx2) return;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx1.configure({ device, format, alphaMode: 'opaque' });
    ctx2.configure({ device, format, alphaMode: 'opaque' });

    const params = {
      K: Float32Array.from(K.toArray()),
      R: Float32Array.from(R.toArray()),
      t: Float32Array.from(t.toArray()),
    };
    const camToMachMat = Float32Array.from(generateCamToMachineMatrix(params));
    const machToCamMat = Float32Array.from(generateMachineToCamMatrix(params));

    const machineWidth = bounds.max.x - bounds.min.x;
    const machineHeight = bounds.max.y - bounds.min.y;
    const outWidth = 512;
    const outHeight = Math.round((outWidth * machineHeight) / machineWidth);

    const camToMachine = new CamToMachineStep(device, {
      outputSize: [outWidth, outHeight],
      machineBounds: [bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y],
      matrix: camToMachMat,
    });

    const margin = 10;
    const machineToCam = new MachineToCamStep(device, {
      outputSize: camRes,
      machineBounds: [bounds.min.x - margin, bounds.min.y - margin, bounds.max.x + margin, bounds.max.y + margin],
      matrix: machToCamMat,
    });

    let running = true;
    const process = async () => {
      if (!running) return;
      const vid = videoRef.current!;
      if (!vid.videoWidth || !vid.videoHeight) {
        requestAnimationFrame(process);
        return;
      }
      const srcTex = device.createTexture({
        size: [vid.videoWidth, vid.videoHeight],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.copyExternalImageToTexture({ source: vid }, { texture: srcTex }, [vid.videoWidth, vid.videoHeight]);
      const machineTex = await camToMachine.process(srcTex);
      present(device, machineTex, ctx1, outWidth, outHeight);
      const backTex = await machineToCam.process(machineTex);
      present(device, backTex, ctx2, camRes[0], camRes[1]);
      srcTex.destroy();
      machineTex.destroy();
      backTex.destroy();
      requestAnimationFrame(process);
    };
    requestAnimationFrame(process);
    return () => {
      running = false;
    };
  }, [device, bounds, K, R, t, camRes]);

  return (
    <div className="relative w-full h-full p-4 space-y-4">
      <PageHeader title="WebGPU Remap Debug" className="absolute" />
      <video ref={videoRef} src={videoUrl} autoPlay playsInline muted className="hidden" />
      <div className="flex gap-4 pt-16">
        <canvas ref={camToMachineCanvas} width={512} height={512} className="border" />
        <canvas ref={backCanvas} width={camRes[0]} height={camRes[1]} className="border" />
      </div>
    </div>
  );
}

export default RouteComponent;
