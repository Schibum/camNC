export interface SdFile {
  name: string;
  /** Size in bytes, -1 for directories */
  size: number;
  isDirectory: boolean;
  datetime?: string;
}

export interface SdListing {
  path: string;
  files: SdFile[];
  total?: string;
  used?: string;
  occupation?: number;
}

/**
 * Parse the output of `$SD/ListJSON`.
 *
 * Over WebSocket the JSON comes as plain (possibly pretty-printed) lines. On serial-like channels it is
 * wrapped in `[JSON:…]` or `[MSG:JSON:…]` chunks, which are concatenated first.
 */
export function parseListJson(lines: string[]): SdListing {
  const text = lines
    .map(line => {
      const wrapped = line.match(/^\[(?:MSG:)?JSON:(.*)\]$/);
      return wrapped ? wrapped[1]! : line;
    })
    .filter(line => !line.startsWith('[MSG:'))
    .join('\n');
  const raw = JSON.parse(text) as {
    path?: string;
    files?: { name: string; size: string | number; datetime?: string }[];
    total?: string;
    used?: string;
    occupation?: string | number;
  };
  return {
    path: raw.path ?? '',
    files: (raw.files ?? []).map(f => {
      const size = Number(f.size);
      return { name: f.name, size, isDirectory: size < 0, datetime: f.datetime };
    }),
    total: raw.total,
    used: raw.used,
    occupation: raw.occupation === undefined ? undefined : Number(raw.occupation),
  };
}
