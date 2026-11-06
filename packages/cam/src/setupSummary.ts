import type { Vec3 } from './geom';
import { toolProgramKey } from './toolIdentity';
import type { Operation, PartCam, Tool } from './toolpaths';
import type { PlanAccuracy } from './accuracy';
import type { ProgramStatistics } from './programStatistics';
import type { ProgramTimeEstimate } from './timing';

export interface SetupPostSettings {
  profileId: 'fluidnc';
  arcs: boolean;
  arcTolerance: number;
  spindleDwell: number;
}

export interface ProgramBounds {
  min: Vec3;
  max: Vec3;
}

export interface SetupSummary {
  schemaVersion: 1;
  /** Reproducibility identifier, not a cryptographic integrity or machine-safety proof. */
  planFingerprint: string;
  programName?: string;
  units: 'mm';
  origin: { xy: 'stock lower left' | 'feature frame'; z: 'stock bottom' };
  stockSize?: Vec3;
  stockTop: number;
  safeZ: number;
  retractZ: number;
  spindle: 'hand' | 'controller';
  post?: SetupPostSettings;
  accuracy?: PlanAccuracy;
  statistics?: ProgramStatistics;
  timing?: ProgramTimeEstimate;
  /** Explicit initial blank, expressed in the same frame as the planned moves. */
  blankFootprint?: [number, number][][];
  tools: { key: string; tool: Tool; rpm: number; maximumCutDepth: number }[];
  operations: {
    name: string;
    feature: Operation['feature'];
    toolKey: string;
    presetId?: string;
    presetName?: string;
    feeds: number[];
    passes: number;
    bounds: ProgramBounds | null;
    roles: Record<string, number>;
  }[];
  bounds: ProgramBounds | null;
  warnings: string[];
}

export interface SetupSummaryOptions {
  programName?: string;
  xyOrigin?: SetupSummary['origin']['xy'];
  stockSize?: Vec3;
  spindle?: 'hand' | 'controller';
  spindleRpm?: number;
  safeZ?: number;
  retractZ?: number;
  post?: SetupPostSettings;
}

export function setupXYOrigin(cam: PartCam, override?: SetupSummary['origin']['xy']): SetupSummary['origin']['xy'] {
  return (
    override ??
    (cam.stockFootprint && !cam.stockFootprint.some(path => path.some(point => Math.abs(point.x) < 1e-9 && Math.abs(point.y) < 1e-9))
      ? 'feature frame'
      : 'stock lower left')
  );
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => [key, canonical(v)])
    );
  return value;
}

/** Stable across object insertion order; operation and point order remain significant. */
export function planFingerprint(cam: PartCam, options: SetupSummaryOptions = {}): string {
  const source = JSON.stringify(canonical({ cam, options }));
  let first = 0x811c9dc5,
    second = 0x9e3779b9;
  for (let i = 0; i < source.length; i++) {
    first = Math.imul(first ^ source.charCodeAt(i), 0x01000193);
    second = Math.imul(second ^ source.charCodeAt(i), 0x85ebca6b);
  }
  return `cam-plan-v1-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function operationBounds(operation: Operation): ProgramBounds | null {
  const bounds: ProgramBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let points = 0;
  for (const pass of operation.passes)
    for (const point of pass.pts) {
      points++;
      for (let axis = 0; axis < 3; axis++) {
        bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
      }
    }
  return points ? bounds : null;
}

export function summarizeSetup(cam: PartCam, options: SetupSummaryOptions = {}): SetupSummary {
  const tools: SetupSummary['tools'] = [];
  const operations = cam.operations.map(operation => {
    const key = toolProgramKey(operation.tool, options.spindleRpm ?? 15000);
    let tool = tools.find(item => item.key === key);
    if (!tool) {
      tool = { key, tool: { ...operation.tool }, rpm: operation.tool.rpm ?? options.spindleRpm ?? 15000, maximumCutDepth: 0 };
      tools.push(tool);
    }
    const roles: Record<string, number> = {};
    for (const pass of operation.passes) {
      for (const role of pass.roles ?? []) roles[role] = (roles[role] ?? 0) + 1;
    }
    const bounds = operationBounds(operation);
    if (bounds) tool.maximumCutDepth = Math.max(tool.maximumCutDepth, cam.stockTop - bounds.min[2]);
    return {
      name: operation.name,
      feature: operation.feature,
      toolKey: key,
      presetId: operation.tool.presetId,
      presetName: operation.tool.presetName,
      feeds: [...new Set(operation.passes.flatMap(pass => pass.feeds))].sort((a, b) => a - b),
      passes: operation.passes.length,
      bounds,
      roles,
    };
  });
  const bounds: ProgramBounds | null = operations.some(operation => operation.bounds)
    ? {
        min: [0, 1, 2].map(axis =>
          Math.min(...operations.flatMap(operation => (operation.bounds ? [operation.bounds.min[axis]] : [])))
        ) as Vec3,
        max: [0, 1, 2].map(axis =>
          Math.max(...operations.flatMap(operation => (operation.bounds ? [operation.bounds.max[axis]] : [])))
        ) as Vec3,
      }
    : null;
  return {
    schemaVersion: 1,
    planFingerprint: planFingerprint(cam, options),
    programName: options.programName,
    units: 'mm',
    origin: {
      xy: setupXYOrigin(cam, options.xyOrigin),
      z: 'stock bottom',
    },
    stockSize: options.stockSize && [...options.stockSize],
    stockTop: cam.stockTop,
    safeZ: options.safeZ ?? cam.safeZ ?? cam.stockTop + 5,
    retractZ: options.retractZ ?? cam.retractZ ?? cam.stockTop + 2,
    spindle: options.spindle ?? 'hand',
    post: options.post && { ...options.post },
    accuracy: cam.accuracy && { ...cam.accuracy, budget: { ...cam.accuracy.budget } },
    blankFootprint: cam.stockFootprint?.map(path => path.map(point => [point.x, point.y])),
    tools,
    operations,
    bounds,
    warnings: [...cam.warnings],
  };
}

const number = (value: number) => +value.toFixed(3);
const cell = (value: string) => value.replace(/[\r\n|]/g, ' ');

/** Exportable setup instructions, with the same stock-bottom datum as the posted program. */
export function setupSheet(summary: SetupSummary): string {
  const lines = [
    `# ${cell(summary.programName ?? 'Machining setup')}`,
    '',
    `Plan: ${summary.planFingerprint}`,
    '',
    `Units: mm. XY0: ${summary.origin.xy === 'stock lower left' ? 'stock lower left' : 'programmed feature frame'}. Z0: stock bottom.`,
    `Stock top: Z${number(summary.stockTop)}. Safe: Z${number(summary.safeZ)}. Retract: Z${number(summary.retractZ)}.`,
    `Spindle switching: ${summary.spindle === 'hand' ? 'manual router, follow the program pauses' : 'controller'}.`,
    ...(summary.post
      ? [
          `Post: ${summary.post.profileId}. Arc fitting: ${summary.post.arcs ? `${number(summary.post.arcTolerance)} mm` : 'disabled'}. Spindle dwell: ${number(summary.post.spindleDwell)} s.`,
        ]
      : []),
    ...(summary.accuracy
      ? [
          `Geometry budget: ${number(summary.accuracy.budget.total)} mm from ${summary.accuracy.scope === 'features' ? 'supplied features' : 'caller-declared source uncertainty'}. Stage limits are planning inputs, not physical machining qualification.`,
        ]
      : []),
    ...(summary.statistics
      ? [
          `Program: ${summary.statistics.motionBlocks} motion blocks, ${summary.statistics.arcBlocks} arcs, ${summary.statistics.feedChanges} feed changes, ${summary.statistics.tinyCuttingLines} cutting lines shorter than ${number(summary.statistics.tinySegmentThresholdMm)} mm.`,
        ]
      : []),
    ...(summary.timing
      ? [
          `Estimated automatic time: ${(summary.timing.estimatedAutomaticSeconds / 60).toFixed(1)} min (${summary.timing.profileId}, ${summary.timing.profileProvenance}). Dwell: ${number(summary.timing.dwellSeconds)} s. Manual pauses: ${summary.timing.manualPauseCount}; operator time is additional.`,
          ...(summary.statistics && summary.timing.estimatedAutomaticSeconds > 0
            ? [
                `Average motion blocks per modeled automatic minute: ${number((summary.statistics.motionBlocks * 60) / summary.timing.estimatedAutomaticSeconds)}.`,
              ]
            : []),
          ...summary.timing.warnings.map(warning => `Timing note: ${cell(warning)}`),
        ]
      : []),
    'Home the machine before the final machine-coordinate park. Re-zero Z after changing a physical tool.',
    '',
    '| Tool | Diameter mm | RPM | Maximum cut depth mm | Flute length mm | Stickout mm |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...summary.tools.map(
      ({ tool, rpm, maximumCutDepth }) =>
        `| T${tool.number} ${cell(tool.name ?? '')} | ${number(tool.diameter)} | ${number(rpm)} | ${number(maximumCutDepth)} | ${tool.fluteLength ?? 'unmeasured'} | ${tool.stickout ?? 'unmeasured'} |`
    ),
    '',
    '| Operation | Feature / preset | Passes | Feed range mm/min | Lowest Z |',
    '| --- | --- | ---: | ---: | ---: |',
    ...summary.operations.map(
      operation =>
        `| ${cell(operation.name)} | ${operation.feature}${operation.presetName ? ` / ${cell(operation.presetName)}` : ''} | ${operation.passes} | ${operation.feeds.length ? `${number(operation.feeds[0])}–${number(operation.feeds.at(-1)!)}` : 'none'} | ${operation.bounds ? number(operation.bounds.min[2]) : 'no cutting motion'} |`
    ),
    ...(summary.warnings.length ? ['', '## Planning notes', '', ...summary.warnings.map(warning => `- ${cell(warning)}`)] : []),
    '',
  ];
  return lines.join('\n');
}

export interface MachiningRecord {
  schemaVersion: 1;
  setup: SetupSummary;
  machine: { id: string; controllerVersion: string; configurationFingerprint: string };
  material: { name: string; measuredThickness: number; batch?: string; moisturePercent?: number };
  recordedAt: string;
  /** References to retained measurements, configuration files, run logs, or finish photos. */
  attachments?: { label: string; uri: string; sha256?: string }[];
  observation: {
    kind: 'planned' | 'dry-run' | 'cut';
    cuttingSeconds?: number;
    dimensionalErrorsMm?: number[];
    chatter?: boolean;
    notes?: string;
  };
}

/** A retained run record reports observations; it never promotes another plan to a qualified process. */
export function machiningRecord(setup: SetupSummary, details: Omit<MachiningRecord, 'schemaVersion' | 'setup'>): MachiningRecord {
  if (!details.machine.id || !details.machine.controllerVersion || !details.machine.configurationFingerprint || !details.material.name)
    throw new Error('A machining record requires machine, controller, configuration and material identity');
  if (!Number.isFinite(details.material.measuredThickness) || details.material.measuredThickness <= 0)
    throw new Error('Measured stock thickness must be positive');
  if (
    details.material.moisturePercent !== undefined &&
    (!Number.isFinite(details.material.moisturePercent) || details.material.moisturePercent < 0 || details.material.moisturePercent > 100)
  )
    throw new Error('Measured moisture must be between 0 and 100 percent');
  if (details.attachments?.some(file => !file.label || !file.uri || (file.sha256 !== undefined && !/^[0-9a-f]{64}$/i.test(file.sha256))))
    throw new Error('Record attachments require a label, location, and valid SHA-256 when supplied');
  if (!Number.isFinite(Date.parse(details.recordedAt))) throw new Error('A machining record requires a valid recording date');
  if (!['planned', 'dry-run', 'cut'].includes(details.observation.kind)) throw new Error('Unknown machining observation kind');
  if (
    details.observation.cuttingSeconds !== undefined &&
    (!Number.isFinite(details.observation.cuttingSeconds) || details.observation.cuttingSeconds < 0)
  )
    throw new Error('Observed cutting time must be nonnegative');
  if (details.observation.dimensionalErrorsMm?.some(value => !Number.isFinite(value)))
    throw new Error('Measured dimensional errors must be finite');
  return JSON.parse(JSON.stringify({ ...details, schemaVersion: 1, setup })) as MachiningRecord;
}
