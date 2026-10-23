import { describe, expect, it } from 'vitest';
import { parseListJson } from './list-json';

describe('parseListJson', () => {
  it('parses pretty-printed 4.x output', () => {
    const lines = ['{"files":[', '    ', '  ],', '  "path":"",', '  "total":"926.35 GB",', '  "occupation":"92"', '}'];
    expect(parseListJson(lines)).toMatchObject({ files: [], occupation: 92 });
  });

  it('joins [JSON:…] chunks and marks directories', () => {
    const lines = ['[JSON:{"files":[{"name":"a.nc","size":"12"},]', '[JSON:{"name":"dir","size":"-1"}],"path":"/"}]'];
    expect(parseListJson(lines).files).toEqual([
      { name: 'a.nc', size: 12, isDirectory: false, datetime: undefined },
      { name: 'dir', size: -1, isDirectory: true, datetime: undefined },
    ]);
  });
});
