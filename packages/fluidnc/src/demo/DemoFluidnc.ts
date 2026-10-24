import { FakeFluidnc } from '../testing/FakeFluidnc';
import { compileGcode, distance, MotionInterpreter, parseWords, Segment, stripComments, Vec } from './gcode-motion';

const kTickMs = 100;
const kRapidFeed = 6000;
/** Words that make a line a motion command rather than a setting. */
const kNonMotion = /G(?:10|28|30|38|92)/;

/**
 * A FluidNC for the in-browser demo. It is the scripted {@link FakeFluidnc} plus real motion: jogs,
 * G-code lines and SD jobs move the position along the path at the programmed feed (scaled by the
 * feed override and `speed`), so the position readout, the marker and the job progress behave like
 * on a machine. There is no acceleration planning.
 *
 * Inject like the fake: `new CncApi(demo.WebSocket, demo.fetch)`, then connect to `demo.host`.
 */
export class DemoFluidnc extends FakeFluidnc {
  /** Playback speed. 1 is real time; the demo starts faster so that jobs finish while people watch. */
  speed = 4;

  private queue: Segment[] = [];
  private queueKind: 'Run' | 'Jog' = 'Run';
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTick = 0;
  private jobLength = 1;
  private jobDone = 0;
  private readonly interpreter: MotionInterpreter;

  constructor() {
    super('v4');
    this.host = 'demo-machine.local';
    this.mpos = { x: 3, y: 3, z: 3 };
    // Work zero on the clear right side of the demo camera's bed (Y runs right to left), Z zero below the homed height.
    this.wco = { x: 150, y: 220, z: -30 };
    this.probeContactZ = -40;
    this.interpreter = new MotionInterpreter(this.mpos, this.wco);
  }

  /** Where the machine ends up when everything queued has run. */
  private get endPosition(): Vec {
    return this.queue.at(-1)?.to ?? this.mpos;
  }

  private enqueue(segments: Segment[], kind: 'Run' | 'Jog') {
    if (!this.queue.length) this.queueKind = kind;
    this.queue.push(...segments);
    if (this.state === 'Idle') this.state = kind;
    this.startTimer();
    this.pushStatus();
  }

  private startTimer() {
    if (this.timer) return;
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), kTickMs);
  }

  private stopTimer() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Stop the machine and drop everything planned, e.g. on reset or jog cancel. */
  private clearQueue() {
    this.queue = [];
    this.stopTimer();
  }

  private tick() {
    const now = performance.now();
    let left = Math.min((now - this.lastTick) / 1000, 0.5);
    this.lastTick = now;
    if (this.state.startsWith('Hold') || this.state === 'Alarm') return;
    while (left > 0 && this.queue.length) {
      const segment = this.queue[0]!;
      const override = segment.feed === null ? this.ov.rapid : this.ov.feed;
      const speed = (((segment.feed ?? kRapidFeed) * override) / 100 / 60) * this.speed;
      const length = distance(this.mpos, segment.to);
      const time = speed > 0 ? length / speed : Infinity;
      if (time <= left) {
        this.mpos = { ...segment.to };
        this.jobDone += length;
        left -= time;
        this.queue.shift();
      } else {
        const fraction = left / time;
        for (const axis of ['x', 'y', 'z'] as const) this.mpos[axis] += (segment.to[axis] - this.mpos[axis]) * fraction;
        this.jobDone += length * fraction;
        left = 0;
      }
    }
    if (this.job) this.job.percent = Math.min(99.99, (this.jobDone / this.jobLength) * 100);
    if (this.queue.length) {
      this.pushStatus();
      return;
    }
    this.stopTimer();
    if (this.job) this.progressJob(100);
    else {
      this.state = 'Idle';
      this.pushStatus();
    }
  }

  protected override runFile(path: string) {
    super.runFile(path);
    if (!this.job) return;
    const name = path.replace(/^\/+/, '');
    const text = new TextDecoder().decode(this.files.get(name));
    this.queue = compileGcode(text, this.mpos, this.wco);
    this.queueKind = 'Run';
    this.jobLength = this.queue.reduce((sum, s) => sum + s.length, 0) || 1;
    this.jobDone = 0;
    this.startTimer();
  }

  protected override onLine(line: string) {
    const text = stripComments(line).toUpperCase();
    if (this.state === 'Alarm' || !text) return super.onLine(line);

    if (text.startsWith('$J=')) {
      this.received.push(line);
      if (this.state !== 'Idle' && this.state !== 'Jog') return this.error('Command requires idle state');
      const jog = new MotionInterpreter(this.endPosition, this.wco);
      // Jogs always move at their F value, never as rapids.
      jog.mode = 1;
      const words = parseWords(text);
      const segments = words.F === undefined ? [] : jog.line(text.slice(3));
      if (!segments.length) return this.error('Invalid jog command');
      this.enqueue(segments, 'Jog');
      return this.ok();
    }
    if (text === '$#') {
      this.received.push(line);
      const recorded = this.transcript.responses['$#']!;
      const fmt = (p: Vec) => [p.x, p.y, p.z].map(n => n.toFixed(3)).join(',');
      return this.emit(recorded.map(l => (l.startsWith('[G54:') ? `[G54:${fmt(this.wco)}]` : l)));
    }
    if (!text.startsWith('$') && !kNonMotion.test(text)) {
      this.interpreter.pos = this.endPosition;
      const segments = this.interpreter.line(text);
      this.relative = this.interpreter.relative;
      if (segments.length) {
        this.received.push(line);
        this.enqueue(segments, 'Run');
        return this.ok();
      }
    }
    super.onLine(line);
  }

  protected override onRealtime(byte: number) {
    if (byte === 0x18 || (byte === 0x85 && this.state === 'Jog')) this.clearQueue();
    super.onRealtime(byte);
    // Cycle start after a hold: the base class only knows about jobs.
    if (byte === 0x7e && this.queue.length) {
      this.state = this.job ? 'Run' : this.queueKind;
      this.startTimer();
    }
  }

  /** Stop the timers, e.g. when leaving the demo. */
  dispose() {
    this.clearQueue();
    this.kill();
  }
}
