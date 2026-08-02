export { capture } from "./capture.ts";
export type { CaptureOptions, CaptureOutcome, CaptureSuccess } from "./capture.ts";
export { recordStorageState } from "./auth.ts";
export type { RecordStorageStateOptions, RecordStorageStateResult } from "./auth.ts";
export {
  createBaselineProvider,
  FigmaBaselineProvider,
  WebBaselineProvider,
} from "./baseline.ts";
export type {
  BaselineProvider,
  BaselineResolveOptions,
  BaselineResolveOutcome,
  WebBaselineMeta,
} from "./baseline.ts";
export {
  areaGap,
  avgDeltaE2000,
  compare,
  compositeOnCanvas,
  countRealDiffPixels,
  diffBoundingBox,
  largestRealDiffCluster,
  makeSolidPng,
  padTo,
  parseHexRgb,
  pixelCompare,
  readPng,
  resizeNearest,
  ssimCompare,
  worstGridMatchRatio,
  writePng,
} from "./compare/index.ts";
export {
  checkDoneGate,
  DEFAULT_MAX_BASELINE_AGE_MS,
  DEFAULT_MAX_GOLD_AGE_MS,
  DEFAULT_MAX_SCORE_AGE_MS,
} from "./done-gate.ts";
export type {
  DoneGateOptions,
  DoneGateVerdict,
  DoneGateViewport,
  ViewportVerdict,
} from "./done-gate.ts";
export { fetchGold, goldMetaPath, readGoldMeta, resolveToken } from "./fetch-gold.ts";
export type { FetchGoldOptions, FetchGoldOutcome, GoldMeta } from "./fetch-gold.ts";
export { loadAncestorEnv } from "./load-env.ts";
export { resolveArtifactPath } from "./paths.ts";
export { clearNodeMetaCache } from "./figma-api.ts";
export { checkGoldStaleness, DEFAULT_MAX_GOLD_AGE_DAYS } from "./staleness.ts";
export type { StalenessOptions } from "./staleness.ts";
export { getProfile, PROFILES } from "./profiles.ts";
export type { Profile } from "./profiles.ts";
export { run, runVerification } from "./run.ts";
export type { RunVerificationDependencies } from "./run.ts";
export { doneGateFromArtifact, verify, writeVerificationArtifact } from "./verify.ts";
export type { VerifyOptions } from "./verify.ts";
export { specGate, specSizeTolerance } from "./spec/gate.ts";
export type { SpecGateInput, SpecGateOutcome } from "./spec/gate.ts";
export { styleGate } from "./spec/style-gate.ts";
export type { StyleGateInput, StyleGateOutcome } from "./spec/style-gate.ts";
export { resolveProfile, validateScope } from "./scope.ts";
export type { ScopeInput } from "./scope.ts";
export { assessStability } from "./stability.ts";
export type { StabilityAssessment } from "./stability.ts";
export { SCHEMA_VERSION, AppError } from "./types.ts";
export {
  DEFAULT_IMAGE_SCALE,
  EXIT_OK,
  EXIT_USAGE_ERROR,
  EXIT_VISUAL_FAIL,
  JSON_INDENT_SPACES,
} from "./constants.ts";
export type {
  CompareOptions,
  CompareOutcome,
  ComputedTextStyle,
  ExpectSize,
  FidelityErrorCode,
  FidelityResult,
  BaselineEvidence,
  FigmaBaselineEvidence,
  ProfileName,
  RejectResult,
  RunArtifacts,
  RunEvidenceHashes,
  RunOptions,
  RunResult,
  RunType,
  Stability,
  TopIssue,
  TopIssueKind,
  TopIssueSeverity,
  VerificationRunOptions,
  WebBaselineEvidence,
} from "./types.ts";
export {
  profileSchema,
  runTypeSchema,
  viewportSchema,
  expectSizeSchema,
  baselineSchema,
  figmaBaselineSchema,
  webBaselineSchema,
  webTargetSchema,
  verificationContractSchema,
  verificationRequestSchema,
  verificationArtifactSchema,
} from "@figloom/contracts";
export type {
  VerificationArtifact,
  VerificationContract,
  VerificationRequest,
  BaselineSource,
  FigmaBaselineSource,
  WebBaselineSource,
  WebTarget,
} from "@figloom/contracts";
