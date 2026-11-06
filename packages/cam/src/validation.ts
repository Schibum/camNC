import type { PartFeatures } from './features';
import type { PathD, PathsD } from './geom';
import type { CamSettings, Tool } from './toolpaths';

export interface CamInputIssue {
  field: string;
  message: string;
}

/** Invalid cutting data is rejected before geometry algorithms or machine output run. */
export class CamInputError extends Error {
  constructor(readonly issues: CamInputIssue[]) {
    super(issues.map(issue => `${issue.field}: ${issue.message}`).join('; '));
    this.name = 'CamInputError';
  }
}

const fail = (field: string, message: string): never => {
  throw new CamInputError([{ field, message }]);
};

export function finiteValue(field: string, value: number): void {
  if (!Number.isFinite(value)) fail(field, 'must be finite');
}

export function positiveValue(field: string, value: number): void {
  finiteValue(field, value);
  if (value <= 0) fail(field, 'must be greater than zero');
}

function nonnegative(field: string, value: number): void {
  finiteValue(field, value);
  if (value < 0) fail(field, 'must not be negative');
}

export function validateTool(tool: Tool, field = 'tool'): void {
  if (!tool || typeof tool !== 'object') fail(field, 'is required');
  positiveValue(`${field}.number`, tool.number);
  if (!Number.isInteger(tool.number)) fail(`${field}.number`, 'must be an integer');
  positiveValue(`${field}.diameter`, tool.diameter);
  for (const key of [
    'stepdown',
    'feed',
    'plungeFeed',
    'rampFeed',
    'leadFeed',
    'leadOutFeed',
    'finishFeed',
    'reducedFeed',
    'transitionFeed',
    'rpm',
    'stepover',
    'finalFeedFactor',
    'fluteLength',
    'stickout',
    'flutes',
  ] as const)
    if (tool[key] !== undefined) positiveValue(`${field}.${key}`, tool[key]);
  if (tool.flutes !== undefined && !Number.isInteger(tool.flutes)) fail(`${field}.flutes`, 'must be an integer');
  if (tool.stepover !== undefined && tool.stepover > tool.diameter) fail(`${field}.stepover`, 'must not exceed the tool diameter');
  if (tool.stepover !== undefined && tool.stepover < 0.001) fail(`${field}.stepover`, 'must be at least 0.001 mm');
}

export function validateCamSettings(settings: CamSettings): void {
  if (!Array.isArray(settings.tools) || !settings.tools.length) fail('tools', 'at least one cutting tool is required');
  settings.tools.forEach((tool, i) => validateTool(tool, `tools[${i}]`));
  for (const key of [
    'feed',
    'plungeFeed',
    'stepoverFactor',
    'pocketFinishFeedFactor',
    'finalFeedFactor',
    'safeHeight',
    'retractHeight',
  ] as const)
    positiveValue(key, settings[key]);
  for (const key of [
    'maxStepdown',
    'profileStepdown',
    'profileFinishStepdown',
    'pocketFinishStepdown',
    'profileLeadRadius',
    'rampFeed',
    'leadFeed',
    'leadOutFeed',
    'finishFeed',
    'reducedFeed',
    'transitionFeed',
    'spindleRpm',
  ] as const)
    if (settings[key] !== undefined) positiveValue(key, settings[key]);
  positiveValue('material.stepdownFactor', settings.material?.stepdownFactor);
  if (settings.stepoverFactor > 1) fail('stepoverFactor', 'must not exceed one tool diameter');
  for (const tool of settings.tools)
    if ((tool.stepover ?? settings.stepoverFactor * tool.diameter) < 0.001)
      fail('stepoverFactor', 'must produce at least 0.001 mm between passes');
  for (const key of ['leaveStock', 'pocketWallAllowance', 'innerCornerRadius'] as const) nonnegative(key, settings[key]);
  if (settings.openWallAllowance !== undefined) nonnegative('openWallAllowance', settings.openWallAllowance);
  if (settings.pocketFloorAllowance !== undefined) nonnegative('pocketFloorAllowance', settings.pocketFloorAllowance);
  if (settings.profileEntry !== undefined && !['plunge', 'ramp', 'tangent'].includes(settings.profileEntry))
    fail('profileEntry', 'must be plunge, ramp, or tangent');
  if (settings.cornerFeed) {
    for (const key of ['factor', 'minAngleDeg', 'maxRadius', 'distance'] as const)
      positiveValue(`cornerFeed.${key}`, settings.cornerFeed[key]);
    if (settings.cornerFeed.factor > 1) fail('cornerFeed.factor', 'must not exceed one');
    if (settings.cornerFeed.minAngleDeg >= 180) fail('cornerFeed.minAngleDeg', 'must be less than 180 degrees');
  }
  for (const key of ['profileRoughBottom', 'finalZ'] as const) finiteValue(key, settings[key]);
  for (const key of ['stockTop', 'outlineFloor'] as const) if (settings[key] !== undefined) finiteValue(key, settings[key]);
  positiveValue('rampAngleDeg', settings.rampAngleDeg);
  if (settings.rampAngleDeg >= 90) fail('rampAngleDeg', 'must be less than 90 degrees');
  if (settings.safeHeight < settings.retractHeight) fail('safeHeight', 'must be at least retractHeight');
  if (settings.tabs) {
    for (const key of ['height', 'width', 'spacing', 'minCount'] as const) positiveValue(`tabs.${key}`, settings.tabs[key]);
    if (!Number.isInteger(settings.tabs.minCount)) fail('tabs.minCount', 'must be an integer');
    if (settings.tabs.rampLength !== undefined) nonnegative('tabs.rampLength', settings.tabs.rampLength);
    settings.tabs.centers?.forEach((point, i) => {
      finiteValue(`tabs.centers[${i}].x`, point.x);
      finiteValue(`tabs.centers[${i}].y`, point.y);
    });
  }
}

export function validatePaths(paths: PathsD, field: string): void {
  paths.forEach((path: PathD, i) => {
    if (path.length < 3) fail(`${field}[${i}]`, 'a closed boundary needs at least three points');
    path.forEach((point, j) => {
      finiteValue(`${field}[${i}][${j}].x`, point.x);
      finiteValue(`${field}[${i}][${j}].y`, point.y);
    });
  });
}

export function validateFeatures(features: PartFeatures): void {
  positiveValue('thickness', features.thickness);
  for (const key of ['footprint', 'outlines', 'throughHoles'] as const) validatePaths(features[key], key);
  features.levels.forEach((level, i) => {
    finiteValue(`levels[${i}].z`, level.z);
    validatePaths(level.region, `levels[${i}].region`);
  });
  features.pockets.forEach((pocket, i) => {
    finiteValue(`pockets[${i}].floorZ`, pocket.floorZ);
    if (pocket.floorZ > features.thickness) fail(`pockets[${i}].floorZ`, 'must not be above the part top');
    validatePaths(pocket.region, `pockets[${i}].region`);
    validatePaths(pocket.strictRegion, `pockets[${i}].strictRegion`);
    validatePaths(pocket.above, `pockets[${i}].above`);
  });
}

/** A bounded pass count also rejects underflowing increments that cannot make numerical progress. */
export function validateDepthRange(top: number, bottom: number, maxStep: number): void {
  finiteValue('topZ', top);
  finiteValue('floorZ', bottom);
  positiveValue('stepdown', maxStep);
  if (bottom > top) fail('floorZ', 'must not be above the cut top');
  if ((top - bottom) / maxStep > 10_000) fail('stepdown', 'would require more than 10000 depth passes');
}
