import { SCHEMA_VERSION, type WebTarget } from "@figloom/contracts";

export { SCHEMA_VERSION };

export class AppError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AppError";
  }
}

export type ProfileName = "page" | "component/strict" | "component/dev";

export type RunType = "dev" | "final";

export type Stability = "stable" | "borderline" | "unknown";

export type FidelityErrorCode =
  | "SCOPE_REQUIRED"
  | "NODE_ID_REQUIRED"
  | "NODE_ID_INVALID"
  | "SELECTOR_REQUIRED"
  | "PAGE_REASON_REQUIRED"
  | "PAGE_REASON_FORBIDDEN"
  | "PAGE_SELECTOR_FORBIDDEN"
  | "EXPECT_SIZE_REQUIRED"
  | "EXPECT_SIZE_FORBIDDEN"
  | "GOLD_META_REQUIRED"
  | "GOLD_META_INVALID"
  | "GOLD_NOT_FOUND"
  | "GOLD_PATH_INVALID"
  | "GOLD_NODE_MISMATCH"
  | "BASELINE_INVALID"
  | "BASELINE_NOT_FOUND"
  | "BASELINE_PATH_INVALID"
  | "BASELINE_SOURCE_MISMATCH"
  | "STORAGE_STATE_NOT_CONFIGURED"
  | "STORAGE_STATE_NOT_FOUND"
  | "TARGET_URL_MISMATCH"
  | "READY_SELECTOR_NOT_FOUND"
  | "READY_SELECTOR_AMBIGUOUS"
  | "SELECTOR_NOT_FOUND"
  | "SELECTOR_AMBIGUOUS";

export type TopIssueKind =
  | "size"
  | "expect-size"
  | "pixel"
  | "ssim"
  | "color"
  | "cluster"
  | "spec-size-mismatch"
  | "style-typography"
  | "style-color"
  | "baseline-stability"
  | "capture-stability"
  | "residual";

export type TopIssueSeverity = "high" | "medium" | "low";

export interface TopIssue {
  severity: TopIssueSeverity;
  kind: TopIssueKind;
  message: string;
  hint?: string;
  /**
   * true: message names one concrete property/value an agent can set (a size
   * contract, a spec-gate/style-gate mismatch with an explicit expected value).
   * false: an aggregate render-level symptom (pixel/SSIM/deltaE/cluster/residual)
   * that doesn't map to a single CSS declaration; useful for diagnosis, not
   * a direct repair instruction.
   */
  repairCandidate: boolean;
}

export interface RejectResult {
  schemaVersion: typeof SCHEMA_VERSION;
  ok: false;
  error: FidelityErrorCode;
  message: string;
  matchCount?: number;
}


export interface RunArtifacts {
  baseline: string;
  baselineMeta: string;
  actual: string;
  score: string;
  diff: string | null;
  punchList: string;
  meta: string;
}

export interface FigmaBaselineEvidence {
  kind: "figma";
  path: string;
  metaPath: string;
  fileKey: string;
  nodeId: string;
  fetchedAt: string;
  lastModified: string | null;
}

export interface WebBaselineEvidence {
  kind: "web";
  path: string;
  metaPath: string;
  url: string;
  revision: string;
  capturedAt: string;
  stability: Stability;
}

export type BaselineEvidence = FigmaBaselineEvidence | WebBaselineEvidence;

export interface RunEvidenceHashes {
  baseline: string;
  baselineMeta: string;
  actual: string;
  diff: string | null;
}

export interface RunResult {
  schemaVersion: typeof SCHEMA_VERSION;
  ok: true;
  pass: boolean;
  runType: RunType;
  viewport: string;
  profile: ProfileName;
  pageReason: string | null;
  target: WebTarget;
  selector: string | null;
  expectSize: ExpectSize | null;
  maskSelectors: string[] | null;
  baseline: BaselineEvidence;
  evidenceHashes: RunEvidenceHashes;
  fidelityScore: number;
  matchRatio: number | null;
  ssim: number | null;
  avgDeltaE: number | null;
  areaGapPercent: number;
  clusterFail: boolean;
  stability: Stability;
  capturedAt: string;
  outDir: string;
  artifacts: RunArtifacts;
  topIssues: TopIssue[];
  warnings: string[];
}

export type FidelityResult = RunResult | RejectResult;

export interface ExpectSize {
  width: number;
  height: number;
}

export interface ComputedTextStyle {
  fontFamily: string;
  fontWeight: number;
  fontSizePx: number;
  lineHeightPx: number | null;
  letterSpacingPx: number;
  color: { r: number; g: number; b: number; a: number } | null;
  backgroundColor: { r: number; g: number; b: number; a: number } | null;
}

export interface CompareOptions {
  profile: ProfileName;
  expectSize?: ExpectSize;
  clusterCheck?: boolean;
}

export interface CompareOutcome {
  pass: boolean;
  fidelityScore: number;
  matchRatio: number | null;
  ssim: number | null;
  avgDeltaE: number | null;
  areaGapPercent: number;
  clusterFail: boolean;
  diffPixels: number | null;
  totalPixels: number | null;
  goldSize: { width: number; height: number };
  actualSize: { width: number; height: number };
  resizedForCompare: boolean;
  topIssues: TopIssue[];
  warnings: string[];
  diffPath: string | null;
}

export interface RunOptions {
  url: string;
  nodeId: string;
  selector?: string;
  viewport: string;
  viewportSize: { width: number; height: number };
  profile?: ProfileName;
  pageReason?: string;
  runType?: RunType;
  goldPath: string;
  outDir: string;
  expectSize?: ExpectSize;
  stabilitySamples?: number;
  timeoutMs?: number;
  hideDevtoolsChrome?: boolean;
  devtoolsMarker?: string;
}

export interface ResolvedBaseline {
  evidence: BaselineEvidence;
  warnings: string[];
}

export interface VerificationRunOptions {
  target: WebTarget;
  storageStatePath?: string;
  baseline: ResolvedBaseline;
  selector?: string;
  viewport: string;
  viewportSize: { width: number; height: number };
  profile?: ProfileName;
  pageReason?: string;
  runType?: RunType;
  outDir: string;
  expectSize?: ExpectSize;
  maskSelectors?: string[];
  stabilitySamples?: number;
  timeoutMs?: number;
  hideDevtoolsChrome?: boolean;
  devtoolsMarker?: string;
}
