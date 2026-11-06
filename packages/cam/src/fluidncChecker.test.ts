import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const checker = fileURLToPath(new URL('../test/machining-cases/check-fluidnc.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../test/check-fluidnc.mock.mjs', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'cam-parser-check-'));
const program = join(directory, 'fixture.nc');
writeFileSync(program, '(Fixture)\nG21\nG1 X1 F100\nM2\n');
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function run(environment: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ['--import', fixture, checker, 'ws://127.0.0.1:18848/?independent_session', program], {
    encoding: 'utf8',
    env: { ...process.env, ...environment },
    timeout: 3000,
  });
  const trace = /^Fixture commands: (.*)$/m.exec(result.stdout)?.[1];
  return { ...result, commands: trace ? (JSON.parse(trace) as string[]) : [] };
}

describe('simulator parser checker protocol', () => {
  it('checks every block and finishes check-mode reset without requiring its discarded acknowledgement', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Accepted 1 programs and 4 blocks');
    expect(result.commands).toEqual(['$CD', '$I', '?', '$C', '(Fixture)', 'G21', 'G1 X1 F100', 'M2', '$C']);
  });

  it('reuses check mode left by an interrupted prior checker instead of toggling it off', () => {
    const result = run({ CHECKER_INITIAL_STATE: 'Check' });
    expect(result.status).toBe(0);
    expect(result.commands).toEqual(['$CD', '$I', '?', '(Fixture)', 'G21', 'G1 X1 F100', 'M2', '$C']);
  });

  it('retains the simulated-configuration and idle-state guards before sending program blocks', () => {
    const cases: Record<string, string>[] = [{ CHECKER_REAL_ENDPOINT: '1' }, { CHECKER_INITIAL_STATE: 'Run' }];
    for (const environment of cases) {
      const result = run(environment);
      expect(result.status).toBe(1);
      expect(result.commands).not.toContain('$C');
      expect(result.commands).not.toContain('G21');
    }
    expect(() => execFileSync(process.execPath, [checker, 'ws://192.168.1.1/'], { stdio: 'pipe' })).toThrow();
  });

  it('fails at the exact block on a transport close without retrying or claiming a complete check', () => {
    const result = run({ CHECKER_CLOSE_ON: 'G1 X1 F100' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fixture.nc:3: Simulator connection closed (code 1006');
    expect(result.stderr).toContain('fixture transport failure');
    expect(result.stdout).not.toContain('Accepted');
    expect(result.commands).not.toContain('M2');
    expect(result.commands.filter(command => command === 'G1 X1 F100')).toHaveLength(1);
  });

  it('reports parser rejection and never submits later program blocks', () => {
    const result = run({ CHECKER_ERROR_ON: 'G1 X1 F100' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fixture.nc:3: G1 X1 F100: error:33');
    expect(result.commands).not.toContain('M2');
    expect(result.stdout).not.toContain('Accepted');
  });
});
