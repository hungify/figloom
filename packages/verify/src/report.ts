import * as fs from "node:fs";
import * as path from "node:path";

import { JSON_INDENT_SPACES, SEVERITY_RANK } from "./constants.ts";
import type { StabilityAssessment } from "./stability.ts";
import type { CompareOutcome, RunResult, VerificationRunOptions } from "./types.ts";

export interface ReportInput {
  result: RunResult;
  compareOutcome: CompareOutcome;
  stability: StabilityAssessment;
  options: VerificationRunOptions;
  actualPath: string;
}

export function writeArtifacts(input: ReportInput): void {
  const { result, compareOutcome, stability, options } = input;
  fs.mkdirSync(result.outDir, { recursive: true });

  const score = {
    ...result,
    diffPixels: compareOutcome.diffPixels,
    totalPixels: compareOutcome.totalPixels,
    goldSize: compareOutcome.goldSize,
    actualSize: compareOutcome.actualSize,
    resizedForCompare: compareOutcome.resizedForCompare,
    stabilityDetail: {
      samples: stability.samples,
      maxObservedDiffRatio: stability.maxObservedDiffRatio,
    },
  };
  fs.writeFileSync(result.artifacts.score, `${JSON.stringify(score, null, JSON_INDENT_SPACES)}\n`);

  const runMeta = {
    schemaVersion: result.schemaVersion,
    target: result.target,
    baseline: result.baseline,
    selector: result.selector,
    viewport: result.viewport,
    viewportSize: options.viewportSize,
    profile: result.profile,
    pageReason: result.pageReason,
    runType: result.runType,
    expectSize: result.expectSize,
    actualPath: path.resolve(input.actualPath),
    capturedAt: result.capturedAt,
    stability: result.stability,
    stabilitySamples: stability.samples,
    warnings: result.warnings,
  };
  fs.writeFileSync(result.artifacts.meta, `${JSON.stringify(runMeta, null, JSON_INDENT_SPACES)}\n`);

  const punchList = {
    schemaVersion: result.schemaVersion,
    fidelityScore: result.fidelityScore,
    pass: result.pass,
    items: [...result.topIssues].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    ),
  };
  fs.writeFileSync(result.artifacts.punchList, `${JSON.stringify(punchList, null, JSON_INDENT_SPACES)}\n`);
}
