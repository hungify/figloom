import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  visualScoreArtifactSchema,
  type VisualScoreArtifact,
  type VerificationArtifact,
  type VerificationRequest,
  type DashboardContractResult,
  type DashboardEvent,
  type DashboardPhase,
  type DashboardRun,
  type DashboardSummary,
  type DashboardVerdict,
} from "@figloom/contracts";

type DashboardFileMap = Map<string, string>;
type Listener = (event: DashboardEvent) => void;

export interface DashboardProjection {
  run: DashboardRun;
  files: DashboardFileMap;
}

function runIdFor(artifact: VerificationArtifact): string {
  return crypto
    .createHash("sha256")
    .update(`${artifact.createdAt}\0${artifact.projectRoot}`)
    .digest("hex")
    .slice(0, 16);
}

function summarize(contracts: DashboardContractResult[]): DashboardSummary {
  const summary: DashboardSummary = {
    total: contracts.length,
    queued: 0,
    running: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
  };
  for (const contract of contracts) summary[contract.status] += 1;
  return summary;
}

function overallStatus(summary: DashboardSummary): DashboardVerdict {
  if (summary.running) return "running";
  if (summary.queued) return "queued";
  if (summary.blocked) return "blocked";
  if (summary.failed) return "failed";
  return "passed";
}

function virtualPath(id: string, name: string): string {
  return `contracts/${encodeURIComponent(id)}/${name}`;
}

async function readScore(outDir: string): Promise<VisualScoreArtifact | undefined> {
  try {
    return visualScoreArtifactSchema.parse(JSON.parse(await fs.readFile(path.join(outDir, "visual-score.json"), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function provenance(score: VisualScoreArtifact, contract: VerificationRequest["contracts"][number]): string {
  if (score.baseline?.kind === "figma") {
    const fileKey = score.baseline.fileKey ?? (contract.baseline.kind === "figma" ? contract.baseline.fileKey : "unknown");
    const nodeId = score.baseline.nodeId ?? (contract.baseline.kind === "figma" ? contract.baseline.nodeId : "unknown");
    return `figma://${fileKey}/${nodeId}`;
  }
  return score.baseline?.url ?? (contract.baseline.kind === "web" ? contract.baseline.url : "Figma baseline");
}

export async function projectArtifact(artifact: VerificationArtifact, suiteName?: string): Promise<DashboardProjection> {
  const files: DashboardFileMap = new Map();
  const resultById = new Map(artifact.results.map((result) => [result.id, result]));
  const contracts = await Promise.all(artifact.request.contracts.map(async (contract): Promise<DashboardContractResult> => {
    const result = resultById.get(contract.id)!;
    const score = await readScore(result.outDir);
    const status: DashboardVerdict = !result.ok ? "blocked" : result.pass ? "passed" : "failed";
    const baselinePath = score?.artifacts?.baseline ?? score?.baseline?.path;
    const actualPath = score?.artifacts?.actual ?? path.join(result.outDir, "actual.png");
    const diffPath = score?.artifacts?.diff ?? null;
    const baselineVirtual = virtualPath(contract.id, "baseline.png");
    const actualVirtual = virtualPath(contract.id, "actual.png");
    const diffVirtual = virtualPath(contract.id, "diff.png");
    if (baselinePath) files.set(baselineVirtual, path.resolve(baselinePath));
    if (score) files.set(actualVirtual, path.resolve(actualPath));
    if (diffPath) files.set(diffVirtual, path.resolve(diffPath));
    const hashes = score?.evidenceHashes;
    const evidenceHash = hashes
      ? `sha256:${crypto.createHash("sha256").update(JSON.stringify(hashes)).digest("hex")}`
      : undefined;
    return {
      id: contract.id,
      name: contract.id,
      tags: [contract.viewport.name, contract.scope.kind],
      status,
      phase: "complete",
      baselineKind: contract.baseline.kind,
      ...(score && baselinePath ? {
        baseline: {
          path: baselineVirtual,
          hash: hashes?.baseline,
          width: score.goldSize?.width,
          height: score.goldSize?.height,
          revision: contract.baseline.kind === "web" ? contract.baseline.revision : score.baseline?.fetchedAt,
          provenance: provenance(score, contract),
        },
        actual: {
          path: actualVirtual,
          hash: hashes?.actual,
          width: score.actualSize?.width,
          height: score.actualSize?.height,
          url: artifact.request.target.url,
        },
      } : {}),
      ...(diffPath ? { diff: { path: diffVirtual, hash: hashes?.diff ?? undefined } } : {}),
      capture: {
        kind: contract.scope.kind === "page" ? "viewport" : "element",
        viewport: { width: contract.viewport.width, height: contract.viewport.height },
        ...(contract.scope.kind === "region" ? {
          target: {
            definition: { kind: "css" as const, value: contract.scope.selector },
            matchCount: result.ok ? 1 : 0,
            stable: score?.stability === "stable",
          },
        } : {}),
      },
      ...(score ? {
        comparison: {
          algorithm: "figloom-multi-signal",
          diffPixels: score.diffPixels ?? null,
          diffRatio: score.matchRatio == null ? null : 1 - score.matchRatio,
          matchRatio: score.matchRatio ?? null,
          ssim: score.ssim ?? null,
          avgDeltaE: score.avgDeltaE ?? null,
          fidelityScore: score.fidelityScore ?? 0,
          sizeMatch: score.goldSize?.width === score.actualSize?.width && score.goldSize?.height === score.actualSize?.height,
        },
      } : {}),
      blockers: result.ok ? [] : [{ code: result.error ?? "VERIFY_FAILED", message: result.message ?? "Verification blocked." }],
      ...(evidenceHash ? { evidenceHash } : {}),
      finishedAt: artifact.createdAt,
    };
  }));
  const summary = summarize(contracts);
  return {
    files,
    run: {
      schemaVersion: 1,
      runId: runIdFor(artifact),
      ...(suiteName ? { suiteName } : {}),
      status: overallStatus(summary),
      summary,
      contracts,
      startedAt: artifact.createdAt,
      updatedAt: artifact.createdAt,
      finishedAt: artifact.createdAt,
    },
  };
}

export class LiveDashboardStore {
  readonly #listeners = new Set<Listener>();
  readonly #run: DashboardRun;
  #files: DashboardFileMap = new Map();
  #sequence = 0;

  constructor(request: VerificationRequest, now = new Date(), suiteName?: string) {
    const timestamp = now.toISOString();
    const contracts: DashboardContractResult[] = request.contracts.map((contract) => ({
      id: contract.id,
      name: contract.id,
      tags: [contract.viewport.name, contract.scope.kind],
      status: "queued",
      phase: "queued",
      baselineKind: contract.baseline.kind,
      capture: {
        kind: contract.scope.kind === "page" ? "viewport" : "element",
        viewport: { width: contract.viewport.width, height: contract.viewport.height },
      },
      blockers: [],
    }));
    this.#run = {
      schemaVersion: 1,
      runId: crypto.randomUUID(),
      ...(suiteName ? { suiteName } : {}),
      status: "queued",
      summary: summarize(contracts),
      contracts,
      startedAt: timestamp,
      updatedAt: timestamp,
    };
  }

  snapshot(): DashboardRun {
    return structuredClone(this.#run);
  }

  files(): DashboardFileMap {
    return new Map(this.#files);
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  progress(id: string, phase: string): void {
    const contract = this.#run.contracts.find((item) => item.id === id);
    if (!contract) return;
    contract.status = "running";
    contract.phase = (["baseline", "capture", "compare", "gates", "complete"].includes(phase) ? phase : "capture") as DashboardPhase;
    this.#touch(contract);
  }

  async finish(artifact: VerificationArtifact): Promise<void> {
    const projected = await projectArtifact(artifact, this.#run.suiteName);
    this.#run.status = projected.run.status;
    this.#run.summary = projected.run.summary;
    this.#run.contracts = projected.run.contracts;
    this.#run.updatedAt = projected.run.updatedAt;
    this.#run.finishedAt = projected.run.finishedAt;
    this.#files = projected.files;
    this.#emit({ status: this.#run.status });
  }

  #touch(contract: DashboardContractResult): void {
    this.#run.summary = summarize(this.#run.contracts);
    this.#run.status = overallStatus(this.#run.summary);
    this.#run.updatedAt = new Date().toISOString();
    this.#emit({ contractId: contract.id, phase: contract.phase, status: contract.status });
  }

  #emit(input: Omit<DashboardEvent, "sequence" | "runId" | "timestamp">): void {
    const event: DashboardEvent = {
      sequence: ++this.#sequence,
      runId: this.#run.runId,
      timestamp: new Date().toISOString(),
      ...input,
    };
    for (const listener of this.#listeners) listener(event);
  }
}
