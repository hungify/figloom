export type DashboardVerdict = "queued" | "running" | "passed" | "failed" | "blocked";
export type VerificationPhase = "baseline" | "capture" | "compare" | "gates" | "complete";
export type DashboardPhase = "queued" | VerificationPhase;

export interface DashboardImageEvidence {
  path: string;
  hash?: string;
  width?: number;
  height?: number;
}

export interface DashboardContractResult {
  id: string;
  name: string;
  /** Set when aggregating multiple verification artifacts. */
  feature?: string;
  tags: string[];
  status: DashboardVerdict;
  phase: DashboardPhase;
  baselineKind: "figma" | "web";
  baseline?: DashboardImageEvidence & { revision?: string; provenance: string };
  actual?: DashboardImageEvidence & { url: string };
  diff?: DashboardImageEvidence;
  capture: {
    kind: "viewport" | "element";
    viewport: { width: number; height: number };
    target?: {
      definition: { kind: "css"; value: string };
      matchCount: number;
      stable: boolean;
    };
  };
  comparison?: {
    algorithm: "figloom-multi-signal";
    diffPixels: number | null;
    diffRatio: number | null;
    matchRatio: number | null;
    ssim: number | null;
    avgDeltaE: number | null;
    fidelityScore: number;
    sizeMatch: boolean;
  };
  blockers: Array<{ code: string; message: string }>;
  evidenceHash?: string;
  startedAt?: string;
  finishedAt?: string;
}

export type DashboardSummary = Record<DashboardVerdict, number> & { total: number };

export interface DashboardRun {
  schemaVersion: 1;
  runId: string;
  suiteName?: string;
  status: DashboardVerdict;
  summary: DashboardSummary;
  contracts: DashboardContractResult[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface DashboardEvent {
  sequence: number;
  runId: string;
  contractId?: string;
  phase?: DashboardPhase;
  status: DashboardVerdict;
  timestamp: string;
}
