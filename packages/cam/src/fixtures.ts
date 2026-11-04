import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Sample projects (STEP) and the matching Fusion G-code, checked in under test/fixtures. */
export const FIXTURE_DIR = fileURLToPath(new URL('../test/fixtures', import.meta.url));
/** Generated G-code / PNGs for eyeballing (gitignored). Set CAM_OUT_DIR to write elsewhere. */
export const OUT_DIR = process.env.CAM_OUT_DIR ?? fileURLToPath(new URL('../test/out', import.meta.url));

const fileName = (name: string) => name.replace(/ /g, '-');
export const fixturePath = (file: string) => `${FIXTURE_DIR}/${fileName(file)}`;
export const readStep = (name: string) => new Uint8Array(readFileSync(fixturePath(`${name}.step`)));
export const fusionGcodePath = (name: string) => fixturePath(`${name}.gcode`);
