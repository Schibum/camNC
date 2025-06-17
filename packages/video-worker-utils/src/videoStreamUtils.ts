import * as Comlink from 'comlink';
import './media-stream-processor-polyfil';

export async function urlToMediaStream(url: string, resolution?: { width: number; height: number }): Promise<MediaStream> {
  const video = document.createElement('video');
  video.src = url;
  video.crossOrigin = 'anonymous';
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    video.addEventListener(
      'loadedmetadata',
      () => {
        video.play().then(resolve).catch(reject);
      },
      { once: true }
    );
    video.addEventListener('error', reject, { once: true });
  });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context from canvas');
  }

  if (resolution) {
    canvas.width = resolution.width;
    canvas.height = resolution.height;
  } else {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  const stream = canvas.captureStream();

  function drawFrame() {
    if (!video.paused && !video.ended && ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      video.requestVideoFrameCallback(drawFrame);
    }
  }
  drawFrame();

  return stream;
}

export async function createVideoStreamProcessor(source: MediaStream | string): Promise<ReadableStream<VideoFrame> | MediaStreamTrack> {
  let mediaStream: MediaStream;
  if (typeof source === 'string') {
    mediaStream = await urlToMediaStream(source);
  } else {
    mediaStream = source;
  }

  const videoTrack = mediaStream.getVideoTracks()[0];
  if (!videoTrack) {
    throw new Error('No video track found in MediaStream');
  }

  if (isMediaStreamTrackProcessorSupported()) {
    const processor = new (window as any).MediaStreamTrackProcessor({ track: videoTrack });
    return processor.readable;
  } else {
    return videoTrack.clone();
  }
}

export interface ReplaceableStreamWorker {
  replaceStream(stream: ReadableStream<VideoFrame> | MediaStreamTrack): Promise<void>;
}

export function attachMediaStreamTrackReplacer(mediaStream: MediaStream, workerProxy: Comlink.Remote<ReplaceableStreamWorker>): () => void {
  if (!isMediaStreamTrackProcessorSupported()) {
    console.warn('MediaStreamTrackProcessor not supported – cannot attach track replacer');
    return () => {};
  }

  let currentTrack: MediaStreamTrack | null = mediaStream.getVideoTracks()[0] || null;

  function handleEnded() {
    const tracks = mediaStream.getVideoTracks();
    if (tracks.length > 0) {
      sendTrackToWorker(tracks[tracks.length - 1]!);
    }
  }

  async function sendTrackToWorker(track: MediaStreamTrack) {
    if (!track) return;
    if (track === currentTrack) return;
    currentTrack = track;
    try {
      let readable: ReadableStream<VideoFrame> | MediaStreamTrack;
      if (isMediaStreamTrackProcessorSupported()) {
        const processor = new (window as any).MediaStreamTrackProcessor({ track });
        readable = processor.readable as ReadableStream<VideoFrame>;
      } else {
        readable = track;
      }
      await workerProxy.replaceStream(Comlink.transfer(readable, [readable]) as any);
      track.addEventListener('ended', handleEnded, { once: true });
      console.log('[attachMediaStreamTrackReplacer] Sent new stream to worker');
    } catch (err) {
      console.error('Failed to send new track to worker', err);
    }
  }

  const handleAddTrack = (event: MediaStreamTrackEvent) => {
    if (event.track.kind !== 'video') return;
    sendTrackToWorker(event.track);
  };

  mediaStream.addEventListener('addtrack', handleAddTrack);
  mediaStream.addEventListener('removetrack', handleAddTrack);

  if (currentTrack) {
    currentTrack.addEventListener('ended', handleEnded, { once: true });
  }

  return () => {
    mediaStream.removeEventListener('addtrack', handleAddTrack);
    mediaStream.removeEventListener('removetrack', handleAddTrack);
    if (currentTrack) {
      currentTrack.removeEventListener('ended', handleEnded);
    }
  };
}

export function isMediaStreamTrackProcessorSupported(): boolean {
  return typeof (window as any).MediaStreamTrackProcessor !== 'undefined';
}
