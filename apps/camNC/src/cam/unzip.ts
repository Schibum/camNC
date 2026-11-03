/**
 * Read the files of a zip archive (stored or deflated entries), e.g. Fusion's `.tools` tool library export, which is
 * a zip with the library JSON inside. Uses the browser's DecompressionStream, no library.
 */
export async function unzip(bytes: Uint8Array): Promise<{ name: string; data: Uint8Array }[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: the last record starting with PK\5\6.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out: { name: string; data: Uint8Array }[] = [];
  for (let k = 0; k < count; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged zip file');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    // The local header's own name/extra lengths decide where the data starts.
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (name.endsWith('/')) continue;
    if (method === 0) out.push({ name, data: raw });
    else if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out.push({ name, data: new Uint8Array(await new Response(stream).arrayBuffer()) });
    } else throw new Error(`Unsupported zip compression (${method}) in ${name}`);
  }
  return out;
}

/** The library JSON of a Fusion tool library file: plain `.json`, or the JSON inside a zipped `.tools` export. */
export async function fusionLibraryText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) return new TextDecoder().decode(bytes);
  const entries = await unzip(bytes);
  const json = entries.find(e => /\.json$/i.test(e.name)) ?? entries[0];
  if (!json) throw new Error('The .tools file is empty');
  return new TextDecoder().decode(json.data);
}
