import { describe, expect, it } from 'vitest';
import { wrongFileMessage } from './GcodeDropZone';

describe('wrongFileMessage', () => {
  it('asks for a model on the CAM pages', () => {
    expect(wrongFileMessage('/cam/')).toMatch(/^Drop a STEP or STL model/);
    expect(wrongFileMessage('/cam/abc/boards')).not.toMatch(/G-code/);
  });

  it('asks for G-code elsewhere, mentioning models', () => {
    expect(wrongFileMessage('/visualize/2DView')).toMatch(/^Drop a G-code file .*STEP\/STL model/);
  });
});
