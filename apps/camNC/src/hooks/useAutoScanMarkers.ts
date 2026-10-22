import * as Comlink from 'comlink';
import { useCallback, useEffect, useRef } from 'react';

import { IMarker } from '@/setup/detect-aruco';
import { ICamSource, getActiveCamSource, useCamSource, useStore } from '@/store/store';
import { getValidMarkers, kExpectedMarkerCount, setMarkersAndRecompute } from '@/store/store-p3p';
import type { MarkerScannerWorkerAPI } from '@/workers/markerScanner.worker';
import { acquireVideoSource, releaseVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { attachMediaStreamTrackReplacer, createVideoStreamProcessor, registerThreeJsTransferHandlers } from '@wbcnc/video-worker-utils';
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
  const activeCamId = useStore(s => s.activeCamId);
  const camSource = useCamSource();
  const url = camSource?.url;
  const calibration = camSource?.calibration;
  const maxResolution = camSource?.maxResolution;

  const scan = useCallback(async () => {
    if (!serviceRef.current) return;
    await serviceRef.current.scan();
  }, []);

  useRunInterval(scan, intervalMs, firstScanDelayMs);

  // Recreate the scanner whenever the camera (or its stream/calibration) changes, so that markers are
  // never scanned with a stale source and written into another camera's settings.
  useEffect(() => {
    const camSource = getActiveCamSource();
    if (!activeCamId || !camSource) return;
    const service = new MarkerScannerService(camSource, async markers => {
      if (useStore.getState().activeCamId !== activeCamId) return;
      await ensureOpenCvIsLoaded();
      setMarkersAndRecompute(markers);
    });
    serviceRef.current = service;

    return () => {
      service.dispose();
      if (serviceRef.current === service) serviceRef.current = null;
    };
  }, [activeCamId, url, calibration, maxResolution]);
}

class MarkerScannerService {
  private unsupportedSource = false;
  private proxy: Comlink.Remote<MarkerScannerWorkerAPI> | null = null;
  private cleanupFn: (() => void) | null = null;
  private initPromise: Promise<void> | null = null;
  private disposed = false;
  // Settles pending work on dispose: terminating the worker leaves outstanding Comlink calls unsettled,
  // which would otherwise block useRunInterval from scheduling further scans.
  private resolveDisposed!: () => void;
  private readonly disposedPromise = new Promise<void>(resolve => {
    this.resolveDisposed = resolve;
  });

  constructor(
    private readonly camSource: ICamSource,
    private readonly onMarkersFound: (markers: IMarker[]) => Promise<void>
  ) {}

  /** Bootstraps the Web Worker and prepares scanning. Safe to call multiple times. */
  init(): Promise<void> {
    if (this.proxy || this.unsupportedSource) return Promise.resolve(); // already initialised
    this.initPromise ??= this.doInit().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    registerThreeJsTransferHandlers();

    const cleanups: (() => void)[] = [];
    const cleanup = () => cleanups.reverse().forEach(fn => fn());
    try {
      // Acquire shared video stream
      const videoHandle = acquireVideoSource(this.camSource.url);
      cleanups.push(() => releaseVideoSource(this.camSource.url));
      const { src } = await videoHandle.connectedPromise;

      const processed = await createVideoStreamProcessor(src);
      cleanups.push(() => {
        if (processed instanceof ReadableStream) {
          processed.cancel?.().catch(() => undefined);
        }
      });
      const mediaStream = src instanceof MediaStream ? src : null;

      // Spawn worker as ESM
      const worker = new Worker(new URL('../workers/markerScanner.worker.ts', import.meta.url), {
        type: 'module',
      });
      cleanups.push(() => worker.terminate());
      const proxy = Comlink.wrap<MarkerScannerWorkerAPI>(worker);

      // Hand the stream to the worker
      await proxy.init(Comlink.transfer(processed as any, [processed as any]), this.camSource.calibration!, this.camSource.maxResolution);

      if (mediaStream) {
        cleanups.push(attachMediaStreamTrackReplacer(mediaStream, proxy));
      }

      if (this.disposed) {
        // Disposed while initialising: nobody else will release these resources.
        cleanup();
        return;
      }
      this.proxy = proxy;
      this.cleanupFn = cleanup;
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  /** Execute a single scan cycle. */
  async scan(): Promise<void> {
    if (this.disposed) return;
    if (!this.proxy) await Promise.race([this.init(), this.disposedPromise]);
    if (!this.proxy || this.disposed) return;
    const markers = await Promise.race([this.proxy.scan(), this.disposedPromise]);
    if (!markers || this.disposed) return;
    const validMarkers = getValidMarkers(markers);
    if (validMarkers.length === kExpectedMarkerCount) {
      await this.onMarkersFound(validMarkers);
    }
  }

  /** Dispose the worker and associated resources. */
  dispose(): void {
    this.disposed = true;
    this.resolveDisposed();
    this.cleanupFn?.();
    this.proxy = null;
    this.cleanupFn = null;
  }
}
