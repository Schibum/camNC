import * as Comlink from 'comlink';
import { useEffect, useRef } from 'react';

import { IMarker } from '@/setup/detect-aruco';
import { ICamSource, useStore } from '@/store/store';
import { updateCameraExtrinsics } from '@/store/store-p3p';
import type { MarkerScannerWorkerAPI } from '@/workers/markerScanner.worker';
import { createVideoStreamProcessor, attachMediaStreamTrackReplacer } from '@wbcnc/video-worker-utils';
import { acquireVideoSource, releaseVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { useRunInterval } from './useRunInterval';

/** Configuration for the automatic marker‑scanner. */
export interface AutoScanOptions {
  intervalMs: number; // polling interval
  firstScanDelayMs?: number; // initial delay (default 5 000 ms)
}

/**
 * React hook that periodically looks for aruco tags
 * and updates machine bounds and extrinsics once all markers appear.
 */
export function useAutoScanMarkers({ intervalMs, firstScanDelayMs = 5_000 }: AutoScanOptions): void {
  const serviceRef = useRef<MarkerScannerService | null>(null);

  async function onMarkersFound(markers: IMarker[]) {
    await ensureOpenCvIsLoaded();
    useStore.getState().camSourceSetters.setMarkerPosInCam(markers.flatMap(m => m.corners));
    updateCameraExtrinsics();
  }

  useRunInterval(
    async () => {
      if (!serviceRef.current) return;
      await serviceRef.current.scan();
    },
    intervalMs,
    firstScanDelayMs
  );

  useEffect(() => {
    const camSource = useStore.getState().camSource!;
    const service = new MarkerScannerService(camSource, onMarkersFound);
    serviceRef.current = service;

    return () => {
      serviceRef.current?.dispose();
      serviceRef.current = null;
    };
  }, []);
}

class MarkerScannerService {
  private unsupportedSource = false;
  private proxy: Comlink.Remote<MarkerScannerWorkerAPI> | null = null;
  private cleanupFn: (() => void) | null = null;

  constructor(
    private readonly camSource: ICamSource,
    private readonly onMarkersFound: (markers: IMarker[]) => void
  ) {}

  /** Bootstraps the Web Worker and prepares scanning. Call once after `new`. */
  async init(): Promise<void> {
    if (this.proxy || this.unsupportedSource) return; // already initialised

    // Acquire shared video stream
    const videoHandle = acquireVideoSource(this.camSource.url);
    const { src } = await videoHandle.connectedPromise;

    const processed = await createVideoStreamProcessor(src);
    const mediaStream = src instanceof MediaStream ? src : null;

    // Spawn worker as ESM
    const worker = new Worker(new URL('../workers/markerScanner.worker.ts', import.meta.url), {
      type: 'module',
    });
    const proxy = Comlink.wrap<MarkerScannerWorkerAPI>(worker);

    // Hand the stream to the worker
    await proxy.init(Comlink.transfer(processed as any, [processed as any]), this.camSource.calibration!, this.camSource.maxResolution);

    let replacerCleanup: (() => void) | null = null;
    if (mediaStream) {
      replacerCleanup = attachMediaStreamTrackReplacer(mediaStream, proxy);
    }

    this.proxy = proxy;
    this.cleanupFn = () => {
      worker.terminate();
      releaseVideoSource(this.camSource.url);
      replacerCleanup?.();
      if (processed instanceof ReadableStream) {
        processed.cancel?.().catch(() => undefined);
      }
    };
  }

  /** Execute a single scan cycle. */
  async scan(): Promise<void> {
    if (!this.proxy) await this.init();
    const markers = await this.proxy!.scan();
    const hasAllMarkers = markers.length === 4 && markers.every((m, i) => m.id === i);
    if (hasAllMarkers) {
      this.onMarkersFound(markers);
    }
  }

  /** Dispose the worker and associated resources. */
  dispose(): void {
    this.cleanupFn?.();
    this.proxy = null;
    this.cleanupFn = null;
  }
}
