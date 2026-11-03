import { existsSync, readFileSync } from 'node:fs';

// Local sample data on the dev machine (not in the repo); tests skip when it is missing.
export const SAMPLE_DIR = '/Users/manu/development/w69b/cnc/sample-data';
export const FUSION_GCODE_DIR = '/Users/manu/development/cnc/gcode';
export const OUT_DIR = `${SAMPLE_DIR}/poc-out`;

export const stepPath = (name: string) => `${SAMPLE_DIR}/${name}.step`;
export const hasFixtures = existsSync(stepPath('kinderregal eiche'));
export const readStep = (name: string) => new Uint8Array(readFileSync(stepPath(name)));
