import * as fs from "node:fs";
import * as path from "node:path";

import { DEFAULT_STABILITY_SAMPLES_FINAL, JSON_INDENT_SPACES } from "./constants.ts";
import { createBaselineProvider, type BaselineProvider } from "./baseline.ts";
import { verificationArtifactSchema, verificationRequestSchema } from "@figloom/contracts";
import { checkDoneGate, type DoneGateViewport } from "./done-gate.ts";
import { resolveArtifactPath } from "./paths.ts";
import { invalidateRunArtifacts, runVerification } from "./run.ts";
import { SCHEMA_VERSION } from "./types.ts";
import type {
  VerificationPhase,
  VerificationArtifact,
  VerificationContract,
  VerificationRequest,
} from "@figloom/contracts";

export interface VerifyOptions {
  projectRoot?: string;
  storageStatePath?: string;
  now?: () => Date;
  onProgress?: (event: { index: number; total: number; id: string; phase: VerificationPhase }) => void;
  providerFor?: (source: VerificationContract["baseline"]) => BaselineProvider;
  runPipeline?: typeof runVerification;
}

export async function verify(
  input: VerificationRequest,
  options: VerifyOptions = {},
): Promise<VerificationArtifact> {
  const request = verificationRequestSchema.parse(input);
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const storageStatePath = options.storageStatePath
    ? path.resolve(options.storageStatePath)
    : undefined;
  const requiresStorageState = request.target.auth === "storageState";
  const results: VerificationArtifact["results"] = [];

  for (let index = 0; index < request.contracts.length; index += 1) {
    const contract = request.contracts[index]!;
    const outDir = resolveArtifactPath(contract.outDir, projectRoot);
    invalidateRunArtifacts(outDir);
    try {
      if (requiresStorageState && !storageStatePath) {
        results.push({
          id: contract.id,
          ok: false,
          pass: false,
          error: "STORAGE_STATE_NOT_CONFIGURED",
          message: "Target requires auth=storageState, but figloom.config.ts has no storageStatePath.",
          outDir,
        });
        continue;
      }
      if (requiresStorageState && storageStatePath && !fs.existsSync(storageStatePath)) {
        results.push({
          id: contract.id,
          ok: false,
          pass: false,
          error: "STORAGE_STATE_NOT_FOUND",
          message: `Playwright storage state not found: ${storageStatePath}.`,
          outDir,
        });
        continue;
      }
      const profile = contract.scope.kind === "region" ? (contract.profile ?? "component/strict") : "page";
      const stabilitySamples = contract.stabilitySamples ?? DEFAULT_STABILITY_SAMPLES_FINAL;
      options.onProgress?.({ index, total: request.contracts.length, id: contract.id, phase: "baseline" });
      const provider = (options.providerFor ?? createBaselineProvider)(contract.baseline);
      if (provider.kind !== contract.baseline.kind) {
        results.push({
          id: contract.id,
          ok: false,
          pass: false,
          error: "BASELINE_PROVIDER_MISMATCH",
          message: `Provider kind "${provider.kind}" cannot resolve "${contract.baseline.kind}" baseline.`,
          outDir,
        });
        continue;
      }
      const resolved = await provider.resolve({
        source: contract.baseline,
        contract,
        outDir,
        profile,
        stabilitySamples,
      });
      if (!resolved.ok) {
        results.push({
          id: contract.id,
          ok: false,
          pass: false,
          error: resolved.error,
          message: resolved.message,
          outDir,
        });
        continue;
      }

      options.onProgress?.({ index, total: request.contracts.length, id: contract.id, phase: "capture" });
      const result = await (options.runPipeline ?? runVerification)({
        target: request.target,
        storageStatePath: requiresStorageState ? storageStatePath : undefined,
        baseline: resolved.baseline,
        viewport: contract.viewport.name,
        viewportSize: {
          width: contract.viewport.width,
          height: contract.viewport.height,
        },
        outDir,
        selector: contract.scope.kind === "region" ? contract.scope.selector : undefined,
        profile,
        pageReason: contract.scope.kind === "page" ? contract.scope.pageReason : undefined,
        runType: "final",
        expectSize: contract.scope.kind === "region" ? contract.scope.expectSize : undefined,
        stabilitySamples,
        timeoutMs: contract.timeoutMs,
        hideDevtoolsChrome: contract.hideDevtoolsChrome,
        devtoolsMarker: contract.devtoolsMarker,
      }, {
        onPhase: (phase) => options.onProgress?.({
          index,
          total: request.contracts.length,
          id: contract.id,
          phase,
        }),
      });
      results.push({
        id: contract.id,
        ok: result.ok,
        pass: result.ok && result.pass,
        ...(!result.ok ? { error: result.error, message: result.message } : {}),
        outDir,
      });
    } catch (error) {
      results.push({
        id: contract.id,
        ok: false,
        pass: false,
        error: "VERIFY_FAILED",
        message: error instanceof Error ? error.message : String(error),
        outDir,
      });
    } finally {
      options.onProgress?.({ index, total: request.contracts.length, id: contract.id, phase: "complete" });
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "figloom.visual-verification",
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    projectRoot,
    request,
    ok: results.every((result) => result.ok),
    allPassed: results.every((result) => result.ok && result.pass),
    results,
  };
}

export function doneGateFromArtifact(
  artifact: VerificationArtifact,
  options: {
    maxScoreAgeMs?: number;
    maxBaselineAgeMs?: number;
    /** @deprecated Use maxBaselineAgeMs. */
    maxGoldAgeMs?: number;
    now?: () => number;
  } = {},
) {
  const viewports = artifact.request.contracts.map((contract) =>
    contractToDoneGate(contract, artifact.request.target, artifact.projectRoot),
  );
  const verdict = checkDoneGate({
    viewports,
    cwd: artifact.projectRoot,
    maxScoreAgeMs: options.maxScoreAgeMs,
    maxBaselineAgeMs: options.maxBaselineAgeMs ?? options.maxGoldAgeMs,
    now: options.now,
  });
  const results = new Map(artifact.results.map((result) => [result.id, result]));
  artifact.request.contracts.forEach((contract, index) => {
    const result = results.get(contract.id);
    if (!result || result.ok !== true || result.pass !== true) {
      verdict.viewports[index]?.reasons.push("verification artifact result is not passing.");
      if (verdict.viewports[index]) verdict.viewports[index].done = false;
    }
  });
  if (artifact.ok !== true || artifact.allPassed !== true) {
    verdict.done = false;
  } else {
    verdict.done = verdict.viewports.every((viewport) => viewport.done);
  }
  return verdict;
}

export function writeVerificationArtifact(filePath: string, artifact: VerificationArtifact): void {
  const validated = verificationArtifactSchema.parse(artifact);
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(validated, null, JSON_INDENT_SPACES)}\n`);
  fs.renameSync(temporary, resolved);
}

function contractToDoneGate(
  contract: VerificationContract,
  target: VerificationRequest["target"],
  projectRoot: string,
): DoneGateViewport {
  return {
    viewport: contract.viewport.name,
    outDir: resolveArtifactPath(contract.outDir, projectRoot),
    baseline: contract.baseline,
    target,
    profile: contract.scope.kind === "page" ? "page" : (contract.profile ?? "component/strict"),
    selector: contract.scope.kind === "region" ? contract.scope.selector : undefined,
    expectSize: contract.scope.kind === "region" ? contract.scope.expectSize : undefined,
    pageReason: contract.scope.kind === "page" ? contract.scope.pageReason : undefined,
  };
}
