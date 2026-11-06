export { loadStep, detectFlat, flipPart, flatMatrix, groupIdentical, analyzeFaces, kMaxSlopedShare } from './import';
export type { StepBody, FlatPart, LoadStepOptions } from './import';
export { extractFeatures } from './features';
export type { PartFeatures, PocketFeature, Level } from './features';
export {
  camPart,
  pocketOperation,
  profileOperation,
  placeTabs,
  DEFAULT_SETTINGS,
  DEFAULT_TABS,
  DEFAULT_TOOL,
  stepdownFor,
  MATERIALS,
} from './toolpaths';
export type { CamSettings, Tool, Material, TabSettings, Operation, Pass, PartCam } from './toolpaths';
export { CamInputError, validateCamSettings, validateFeatures } from './validation';
export type { CamInputIssue } from './validation';
export { samePhysicalTool, toolIdentityKey, toolProgramKey } from './toolIdentity';
export { toGcode, fitArcs, FLUIDNC_POST_PROFILE, validateFluidNCOutput } from './gcode';
export { pauseMarker, parsePauseMarker } from './pauseMarker';
export type { GcodeOptions, SpindleSwitch, FluidNCPostProfile } from './gcode';
export type { PauseMarker } from './pauseMarker';
export { readGcode, metrics } from './analyze';
export type { Move, Metrics } from './analyze';
export { loadStl } from './stl';
export { summarizePart } from './summary';
export type { FeatureChip, PartSummary } from './summary';
export { parseFusionToolLibrary } from './tools';
export type { LibraryTool } from './tools';
export { checkGcodeSafety, checkProgramSafety, kMaxFeed } from './safety';
export type { SafetyIssue, SafetyLimits } from './safety';
export { nestRects, placedSize } from './nest';
export type { Rect, NestItem, NestOptions, NestResult, Placement } from './nest';
export { holdCheck, holdTimeline } from './hold';
export {
  heldByPoints,
  holdClashes,
  holdHeight,
  pathClearance,
  nutReaches,
  kDefaultStickout,
  kHoldDefaults,
  kHoldHeights,
  kClampWidth,
  holdBox,
  holdDist,
  edgeDir,
  snapClamp,
} from './holdPoints';
export type { HoldPoint, HoldKind } from './holdPoints';
export { planTabs, freePartsProgram, kDefaultSkin } from './tabPlan';
export type { PartHolding } from './tabPlan';
export {
  clampPlay,
  defaultHolds,
  edgeBands,
  fewerHolds,
  fixtureBox,
  fixtureFree,
  fixturesAround,
  largestOffcut,
  moreHolds,
  screwPlay,
  settle,
  snapScrew,
  suggestHolds,
  suggestHoldsGrowing,
  workBox,
} from './settle';
export type { BoardSide, EdgeFit, Fixture, SettleBoard, SettlePart, Settled, Spots } from './settle';
export { sideBSpec, dowelClearance, dowelProblem, dowelSpots, dowelOperations } from './flip';
export type { FlipRegistration, DowelSpec, TurnedOver } from './flip';
export type { HoldOptions, PartHold, TabHold, HoldEvent } from './hold';
export {
  camBoard,
  boardBits,
  holdOptionsOf,
  holdsOnParts,
  jobHoldClashes,
  kTapeLayer,
  orderBoardQueue,
  partToBoard,
  releasesAtEnd,
  rotateAboutOrigin,
  splitByBit,
  usesTabs,
} from './board';
export type { BoardPart, BoardSpec, HoldDown } from './board';
export { tabRemovalProgram } from './tabRemoval';
export type { TabStop } from './tabRemoval';
