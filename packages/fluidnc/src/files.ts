import { parseListJson, SdFile, SdListing } from './parsers/list-json';
import { FluidncAbortError, type FluidncProtocol, type MachineStatus } from './protocol';
import { httpUrl } from './socket';
import { xmodemUpload } from './xmodem';

/** How long the socket may stay quiet during an HTTP upload before it counts as dead. */
const kUploadSilenceMs = 60_000;
/** How long to wait for an uploaded file to show up, including a reconnect if the socket dropped meanwhile. */
const kVerifyTimeoutMs = 30_000;

export async function listSdFiles(protocol: FluidncProtocol, path = '/'): Promise<SdListing> {
  const lines = await protocol.send(path === '/' ? '$SD/ListJSON' : `$SD/ListJSON=${path}`, { timeoutMs: 15_000 });
  return parseListJson(lines);
}

function sdPath(name: string) {
  return name.startsWith('/') ? name : `/${name}`;
}

/**
 * Start a file from the SD card. Resolves once the job is seen running (or the command is acknowledged).
 *
 * FluidNC 4.x only sends the `ok` for `$SD/Run` when the file has finished, so the command stays in flight
 * (without timeout) for the whole job. That is fine: during a job only realtime bytes are sent.
 */
export function runSdFile(protocol: FluidncProtocol, name: string, startTimeoutMs = 15_000): Promise<void> {
  const done = protocol.send(`$SD/Run=${sdPath(name)}`, { timeoutMs: 0 });
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      protocol.off('status', onStatus);
    };
    const onStatus = (status: MachineStatus) => {
      if (status.job || status.state === 'Run') {
        cleanup();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${name} did not start`));
    }, startTimeoutMs);
    protocol.on('status', onStatus);
    done.then(
      () => {
        cleanup();
        resolve();
      },
      err => {
        cleanup();
        reject(err);
      }
    );
  });
}

export function deleteSdFile(protocol: FluidncProtocol, name: string) {
  return protocol.send(`$SD/Delete=${sdPath(name)}`);
}

export interface UploadOptions {
  /** `http` (default): `no-cors` POST to `/upload`, verified via `$SD/ListJSON`. `xmodem`: over the socket. */
  method?: 'http' | 'xmodem';
  onProgress?: (fraction: number) => void;
  /** Inject `fetch` for tests. */
  fetchImpl?: typeof fetch;
  verifyTimeoutMs?: number;
}

/** Find a file in a listing; FluidNC 3.9.9 reports names without the directory. */
function findFile(listing: SdListing, name: string): SdFile | undefined {
  const bare = name.replace(/^\/+/, '');
  return listing.files.find(f => f.name.replace(/^\/+/, '') === bare);
}

/**
 * Upload a file to the root of the SD card.
 *
 * FluidNC sends no CORS headers, so the HTTP response cannot be read. The request is still a CORS
 * "simple" request, so it reaches the controller; the result is checked by listing the card.
 */
export async function uploadSdFile(
  protocol: FluidncProtocol,
  host: string,
  name: string,
  content: string | Uint8Array,
  options: UploadOptions = {}
): Promise<void> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const filename = sdPath(name);
  // The upload result cannot be read, so a stale file of the same size would pass the check below. Remove it first.
  if (findFile(await listSdFiles(protocol), filename)) {
    await deleteSdFile(protocol, filename);
    if (findFile(await listSdFiles(protocol), filename)) throw new Error(`Upload failed: could not replace ${filename}`);
  }
  if (options.method === 'xmodem') {
    await xmodemUpload(protocol, `/sd${filename}`, bytes, options.onProgress);
  } else {
    const form = new FormData();
    form.append('path', '/');
    form.append(`${filename}S`, String(bytes.length));
    form.append('myfiles', new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), filename);
    const doFetch = options.fetchImpl ?? fetch;
    // 3.9.x handles the upload in its only network task, so the socket goes quiet meanwhile (about 25 s were seen).
    protocol.socket.allowSilence(kUploadSilenceMs);
    try {
      await doFetch(httpUrl(host, '/upload'), { method: 'POST', mode: 'no-cors', body: form });
    } catch {
      // An opaque response can still be rejected by the page's COEP policy after the upload went through.
      // The listing below is the source of truth.
    }
    options.onProgress?.(1);
  }

  const deadline = Date.now() + (options.verifyTimeoutMs ?? kVerifyTimeoutMs);
  let lastSize: number | undefined;
  for (;;) {
    // Should the socket still have dropped during the upload, keep trying until it is back (nothing is re-sent).
    const listing = await listSdFiles(protocol).catch(err => {
      if (Date.now() > deadline || !(err instanceof FluidncAbortError)) throw err;
      return null;
    });
    const file = listing && findFile(listing, filename);
    lastSize = listing ? file?.size : lastSize;
    if (file && file.size === bytes.length) return;
    if (Date.now() > deadline) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(
    lastSize === undefined
      ? `Upload failed: ${filename} is not on the SD card`
      : `Upload failed: ${filename} has ${lastSize} bytes, expected ${bytes.length}`
  );
}
