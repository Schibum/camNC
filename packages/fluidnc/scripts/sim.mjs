#!/usr/bin/env node
// Run the FluidNC v4.1.1 simulator (native posix build) seeded with the JP2 LowRider config.
//
//   pnpm sim                 # FluidNC 4.1.1 on http://127.0.0.1:8848, socket ws://127.0.0.1:8848/
//   pnpm sim --v3            # plus the 3.9.9 personality on 127.0.0.1:8850 (socket on :8851)
//   pnpm sim --build         # (re)build the simulator first (needs git + PlatformIO, ~3 min)
//   pnpm sim --docker        # build and run the linux_x86_64 sim in Docker instead
//
// The binary is cached in ~/.cache/camnc/fluidnc-<version>/. Set FLUIDNC_SIM_BIN to use another build.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startV3Proxy } from './v3-proxy.mjs';

const VERSION = 'v4.1.1';
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const port = option('--port', 8848);
const v3Port = option('--v3-port', 8850);

const cacheDir = path.join(os.homedir(), '.cache', 'camnc', `fluidnc-${VERSION}`);
const env = process.platform === 'darwin' ? 'macos' : 'linux_x86_64';

function build() {
  const src = path.join(cacheDir, 'src');
  if (!existsSync(src)) {
    mkdirSync(cacheDir, { recursive: true });
    execFileSync('git', ['clone', '--depth', '1', '--branch', VERSION, 'https://github.com/bdring/FluidNC.git', src], { stdio: 'inherit' });
  }
  execFileSync('pio', ['run', '-e', env], { cwd: src, stdio: 'inherit' });
  cpSync(path.join(src, '.pio', 'build', env, 'program'), path.join(cacheDir, 'fluidnc-sim'));
}

function runDocker() {
  const image = `camnc-fluidnc-sim:${VERSION}`;
  execFileSync('docker', ['build', '-t', image, path.join(pkgDir, 'sim')], { stdio: 'inherit' });
  return spawn('docker', ['run', '--rm', '-i', '-p', `127.0.0.1:${port}:${port}`, '-e', `HTTP_PORT=${port}`, image], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

function runNative() {
  const bin = process.env.FLUIDNC_SIM_BIN ?? path.join(cacheDir, 'fluidnc-sim');
  if (flag('--build') || !existsSync(bin)) build();
  const workDir = path.join(pkgDir, '.sim');
  mkdirSync(path.join(workDir, 'native_localfs'), { recursive: true });
  mkdirSync(path.join(workDir, 'native_sd'), { recursive: true });
  cpSync(path.join(pkgDir, 'sim', 'config.yaml'), path.join(workDir, 'native_localfs', 'config.yaml'));
  // The HTTP port lives in the emulated NVS; set it with a short first run.
  execFileSync(bin, [], { cwd: workDir, input: `$HTTP/Port=${port}\n$Telnet/Port=${port + 20}\n$Bye\n`, stdio: ['pipe', 'ignore', 'ignore'], timeout: 10_000 });
  return spawn(bin, [], { cwd: workDir, stdio: ['pipe', 'inherit', 'inherit'] });
}

const child = flag('--docker') ? runDocker() : runNative();
console.log(`FluidNC ${VERSION} simulator: http://127.0.0.1:${port}  (camNC machine host: 127.0.0.1:${port})`);
let proxy;
if (flag('--v3')) {
  proxy = startV3Proxy({ simHost: `127.0.0.1:${port}`, port: v3Port });
  console.log(`3.9.9 personality: camNC machine host 127.0.0.1:${v3Port} (socket on :${v3Port + 1})`);
}
const stop = () => {
  proxy?.close();
  child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', code => {
  proxy?.close();
  process.exit(code ?? 0);
});
