import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { capture, type CaptureOptions, type CaptureOutcome } from "./capture.ts";
import { compare } from "./compare/index.ts";
import {
  DEFAULT_STABILITY_SAMPLES_DEV,
  DEFAULT_STABILITY_SAMPLES_FINAL,
  MIN_STABILITY_SAMPLES,
} from "./constants.ts";
import { goldMetaPath, readGoldMeta } from "./fetch-gold.ts";
import { getProfile } from "./profiles.ts";
import { writeArtifacts } from "./report.ts";
import { resolveProfile, validateScope } from "./scope.ts";
import { specGate } from "./spec/gate.ts";
import { styleGate } from "./spec/style-gate.ts";
import { assessStability } from "./stability.ts";
import type {
  FidelityResult,
  RunOptions,
  RunResult,
  VerificationRunOptions,
} from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

/** Backward-compatible Figma debug adapter. Main verification uses runVerification. */
export async function run(options: RunOptions): Promise<FidelityResult> {
  invalidateRunArtifacts(options.outDir);
  const scopeReject = validateScope(options);
  if (scopeReject) return scopeReject;

  const expectedGoldPath = path.resolve(options.outDir, "figma-gold.png");
  if (path.resolve(options.goldPath) !== expectedGoldPath) {
    return reject("GOLD_PATH_INVALID", `goldPath must be ${expectedGoldPath} for this contract outDir.`);
  }
  if (!fs.existsSync(options.goldPath)) {
    return reject(
      "GOLD_NOT_FOUND",
      `Gold not found on disk: ${options.goldPath}. Run figloom verify or figloom fetch-gold first.`,
    );
  }
  const goldMeta = readGoldMeta(options.goldPath);
  if (!goldMeta) {
    return reject(
      "GOLD_META_REQUIRED",
      "figma-gold.meta.json required; run figloom verify or figloom fetch-gold first.",
    );
  }
  if (
    !goldMeta.fileKey ||
    !goldMeta.nodeId ||
    !goldMeta.fetchedAt ||
    !Number.isFinite(Date.parse(goldMeta.fetchedAt))
  ) {
    return reject(
      "GOLD_META_INVALID",
      "figma-gold.meta.json missing valid fileKey/nodeId/fetchedAt evidence.",
    );
  }
  if (goldMeta.nodeId !== options.nodeId) {
    return reject(
      "GOLD_NODE_MISMATCH",
      `gold nodeId "${goldMeta.nodeId}" does not match run nodeId "${options.nodeId}".`,
    );
  }

  return runVerification({
    target: { kind: "web", url: options.url },
    baseline: {
      evidence: {
        kind: "figma",
        path: path.resolve(options.goldPath),
        metaPath: path.resolve(goldMetaPath(options.goldPath)),
        fileKey: goldMeta.fileKey,
        nodeId: goldMeta.nodeId,
        fetchedAt: goldMeta.fetchedAt,
        lastModified: goldMeta.lastModified,
      },
      warnings: [],
    },
    viewport: options.viewport,
    viewportSize: options.viewportSize,
    selector: options.selector,
    profile: resolveProfile(options),
    pageReason: options.pageReason,
    runType: options.runType,
    outDir: options.outDir,
    expectSize: options.expectSize,
    stabilitySamples: options.stabilitySamples,
    timeoutMs: options.timeoutMs,
    hideDevtoolsChrome: options.hideDevtoolsChrome,
    devtoolsMarker: options.devtoolsMarker,
  });
}

export interface RunVerificationDependencies {
  captureImpl?: (options: CaptureOptions) => Promise<CaptureOutcome>;
  onPhase?: (phase: "compare" | "gates") => void;
}

export async function runVerification(
  options: VerificationRunOptions,
  dependencies: RunVerificationDependencies = {},
): Promise<FidelityResult> {
  invalidateRunArtifacts(options.outDir);
  const profileName = options.profile ?? (options.pageReason ? "page" : "component/strict");
  const profile = getProfile(profileName);
  const runType = options.runType ?? "dev";
  const baselinePath = path.resolve(options.baseline.evidence.path);
  const baselineMetaPath = path.resolve(options.baseline.evidence.metaPath);
  if (!fs.existsSync(baselinePath)) {
    return reject("BASELINE_NOT_FOUND", `Baseline not found on disk: ${baselinePath}.`);
  }
  if (!fs.existsSync(baselineMetaPath)) {
    return reject("BASELINE_INVALID", `Baseline metadata not found on disk: ${baselineMetaPath}.`);
  }

  const outDir = options.outDir;
  const actualPath = path.join(outDir, "actual.png");
  const samples =
    options.stabilitySamples ??
    (runType === "final" ? DEFAULT_STABILITY_SAMPLES_FINAL : DEFAULT_STABILITY_SAMPLES_DEV);
  const captured = await (dependencies.captureImpl ?? capture)({
    url: options.target.url,
    outPath: actualPath,
    viewportSize: options.viewportSize,
    selector: options.selector,
    fullPage: profileName === "page",
    samples,
    timeoutMs: options.timeoutMs,
    hideDevtoolsChrome: options.hideDevtoolsChrome,
    devtoolsMarker: options.devtoolsMarker,
  });
  if (!captured.ok) return captured;

  dependencies.onPhase?.("compare");
  const compareOutcome = compare(baselinePath, actualPath, outDir, {
    profile: profileName,
    expectSize: options.expectSize,
  });
  const stability = assessStability(captured.capturePaths, profile.stabilityMaxDiffRatio);
  cleanupSamples(captured.ephemeralSamplePaths);
  const warnings = [
    ...options.baseline.warnings,
    ...captured.warnings,
    ...compareOutcome.warnings,
  ];
  const topIssues = [...compareOutcome.topIssues];
  let pass = compareOutcome.pass;

  dependencies.onPhase?.("gates");

  if (runType === "final" && stability.stability !== "stable") {
    pass = false;
    topIssues.push({
      severity: "high",
      kind: "capture-stability",
      message: `Target capture stability is ${stability.stability}; final evidence is not deterministic.`,
      hint: "Stabilize target state, fonts, animations, and data before rerunning final verification.",
      repairCandidate: false,
    });
  }

  if (
    options.baseline.evidence.kind === "web" &&
    options.baseline.evidence.stability !== "stable"
  ) {
    pass = false;
    topIssues.push({
      severity: "high",
      kind: "baseline-stability",
      message: `Web baseline stability is ${options.baseline.evidence.stability}; regression reference is not deterministic.`,
      hint: "Stabilize baseline deployment or increase deterministic wait controls, then rerun verify.",
      repairCandidate: false,
    });
  }

  const baselineEvidence = options.baseline.evidence;
  if (profileName !== "page" && baselineEvidence.kind === "figma") {
    const figmaIdentity = {
      fileKey: baselineEvidence.fileKey,
      nodeId: baselineEvidence.nodeId,
    };
    if (!captured.elementRect) {
      warnings.push("spec-gate skipped: no selector element measurement available.");
    } else {
      const spec = await specGate({ ...figmaIdentity, domSize: captured.elementRect });
      warnings.push(...spec.warnings);
      topIssues.push(...spec.topIssues);
      if (spec.pass === false) pass = false;
    }
    if (!captured.computedStyle) {
      warnings.push("style-gate skipped: no computed style available.");
    } else {
      const style = await styleGate({ ...figmaIdentity, domStyle: captured.computedStyle });
      warnings.push(...style.warnings);
      topIssues.push(...style.topIssues);
      if (style.pass === false) pass = false;
    }
  }
  if (samples < MIN_STABILITY_SAMPLES) {
    warnings.push(
      `stability not sampled (samples=${samples}); use runType:"final" or stabilitySamples>=2 for a real stability check.`,
    );
  }

  const result: RunResult = {
    schemaVersion: SCHEMA_VERSION,
    ok: true,
    pass,
    runType,
    viewport: options.viewport,
    profile: profileName,
    pageReason: options.pageReason ?? null,
    target: options.target,
    selector: options.selector ?? null,
    expectSize: options.expectSize ?? null,
    baseline: options.baseline.evidence,
    evidenceHashes: {
      baseline: fileHash(baselinePath),
      baselineMeta: fileHash(baselineMetaPath),
      actual: fileHash(actualPath),
      diff: compareOutcome.diffPath ? fileHash(compareOutcome.diffPath) : null,
    },
    fidelityScore: compareOutcome.fidelityScore,
    matchRatio: compareOutcome.matchRatio,
    ssim: compareOutcome.ssim,
    avgDeltaE: compareOutcome.avgDeltaE,
    areaGapPercent: compareOutcome.areaGapPercent,
    clusterFail: compareOutcome.clusterFail,
    stability: stability.stability,
    capturedAt: captured.capturedAt,
    outDir,
    artifacts: {
      baseline: baselinePath,
      baselineMeta: baselineMetaPath,
      actual: actualPath,
      score: path.join(outDir, "visual-score.json"),
      diff: compareOutcome.diffPath,
      punchList: path.join(outDir, "punch-list.json"),
      meta: path.join(outDir, "run-meta.json"),
    },
    topIssues,
    warnings,
  };
  writeArtifacts({ result, compareOutcome, stability, options, actualPath });
  return result;
}

function reject(error: Extract<FidelityResult, { ok: false }>["error"], message: string) {
  return { schemaVersion: SCHEMA_VERSION, ok: false as const, error, message };
}

function fileHash(filePath: string): string {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function cleanupSamples(samplePaths: string[]): void {
  for (const samplePath of samplePaths) {
    try {
      fs.unlinkSync(samplePath);
    } catch {
    }
  }
  const first = samplePaths[0];
  if (!first) return;
  try {
    fs.rmdirSync(path.dirname(first));
  } catch {
  }
}

export function invalidateRunArtifacts(outDir: string): void {
  for (const name of ["actual.png", "diff.png", "visual-score.json", "run-meta.json", "punch-list.json"]) {
    try {
      fs.unlinkSync(path.join(outDir, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
