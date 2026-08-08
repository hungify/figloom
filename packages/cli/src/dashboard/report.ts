import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { verificationArtifactSchema, FIGLOOM_DIR, VISUAL_VERIFICATION_FILE, VISUAL_VERIFICATIONS_DIR, type DashboardRun, type VerificationArtifact } from "@figloom/contracts";
import { overallStatus, projectArtifact, summarize, type DashboardProjection } from "./model.ts";

export async function readVerificationArtifact(filePath: string): Promise<VerificationArtifact> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(`Cannot read verification artifact ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return verificationArtifactSchema.parse(value);
}

export async function archivedDashboardSource(artifact: VerificationArtifact, suiteName?: string) {
  const projection = await projectArtifact(artifact, suiteName);
  return {
    snapshot: () => projection.run,
    files: () => projection.files,
  };
}

async function findVerificationArtifacts(projectRoot: string): Promise<Array<{ feature: string; filePath: string }>> {
  const base = path.join(projectRoot, FIGLOOM_DIR, VISUAL_VERIFICATIONS_DIR);
  let entries: string[];
  try {
    entries = (await fs.readdir(base, { recursive: true })) as string[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => {
      if (path.basename(entry) !== VISUAL_VERIFICATION_FILE) return false;
      const normalized = entry.split(path.sep).join("/");
      return !normalized.includes("/report/data/");
    })
    .map((entry) => ({
      feature: featureKeyFromArtifactEntry(entry),
      filePath: path.join(base, entry),
    }));
}

export function featureKeyFromArtifactEntry(entry: string): string {
  const parts = entry.split(path.sep);
  parts.pop();
  if (parts.length > 0 && /^run-/.test(parts[parts.length - 1]!)) parts.pop();
  return parts.join("/") || "root";
}

function withFeaturePrefix(projection: DashboardProjection, feature: string): DashboardProjection {
  const prefix = `${encodeURIComponent(feature)}/`;
  const remap = (virtual: string) => (virtual.startsWith("contracts/") ? `${prefix}${virtual}` : virtual);
  const files = new Map<string, string>();
  for (const [virtual, real] of projection.files) files.set(remap(virtual), real);
  const contracts = projection.run.contracts.map((contract) => ({
    ...contract,
    feature,
    id: `${feature}.${contract.id}`,
    ...(contract.baseline ? { baseline: { ...contract.baseline, path: remap(contract.baseline.path) } } : {}),
    ...(contract.actual ? { actual: { ...contract.actual, path: remap(contract.actual.path) } } : {}),
    ...(contract.diff ? { diff: { ...contract.diff, path: remap(contract.diff.path) } } : {}),
  }));
  return { files, run: { ...projection.run, contracts } };
}

export async function aggregateDashboardSource(projectRoot: string) {
  const found = await findVerificationArtifacts(projectRoot);
  const files = new Map<string, string>();
  const contracts: DashboardRun["contracts"] = [];
  let startedAt: string | undefined;
  let updatedAt: string | undefined;

  for (const { feature, filePath } of found) {
    const artifact = await readVerificationArtifact(filePath);
    const projection = withFeaturePrefix(await projectArtifact(artifact, feature), feature);
    for (const contract of projection.run.contracts) contracts.push(contract);
    for (const [virtual, real] of projection.files) files.set(virtual, real);
    if (!startedAt || projection.run.startedAt < startedAt) startedAt = projection.run.startedAt;
    if (!updatedAt || projection.run.updatedAt > updatedAt) updatedAt = projection.run.updatedAt;
  }

  const summary = summarize(contracts);
  const now = new Date().toISOString();
  const run: DashboardRun = {
    schemaVersion: 1,
    runId: crypto.randomUUID(),
    status: overallStatus(summary),
    summary,
    contracts,
    startedAt: startedAt ?? now,
    updatedAt: updatedAt ?? now,
    ...(updatedAt ? { finishedAt: updatedAt } : {}),
  };

  return {
    snapshot: () => run,
    files: () => files,
  };
}

export async function exportDashboardReport(options: {
  artifact: VerificationArtifact;
  suiteName?: string;
  outputDirectory: string;
  clientRoot?: string;
}): Promise<string> {
  const outputDirectory = path.resolve(options.outputDirectory);
  const clientRoot = options.clientRoot ?? fileURLToPath(new URL("../../dist/dashboard", import.meta.url));
  for (const result of options.artifact.results) {
    const sourceRoot = path.resolve(result.outDir);
    if (outputDirectory === sourceRoot || outputDirectory.startsWith(`${sourceRoot}${path.sep}`)) {
      throw new Error(`Report output may not be inside contract artifact directory: ${sourceRoot}`);
    }
  }
  try {
    const entries = await fs.readdir(outputDirectory);
    if (entries.length) throw new Error(`Report output directory must be empty: ${outputDirectory}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const projection = await projectArtifact(options.artifact, options.suiteName);
  await fs.mkdir(path.join(outputDirectory, "data"), { recursive: true });
  await fs.cp(clientRoot, outputDirectory, { recursive: true });
  await fs.writeFile(
    path.join(outputDirectory, "data", VISUAL_VERIFICATION_FILE),
    `${JSON.stringify(projection.run, null, 2)}\n`,
  );
  for (const [relativePath, sourcePath] of projection.files) {
    const destination = path.resolve(outputDirectory, "data", relativePath);
    const dataRoot = path.resolve(outputDirectory, "data");
    if (!destination.startsWith(`${dataRoot}${path.sep}`)) throw new Error(`Unsafe dashboard artifact path: ${relativePath}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(sourcePath, destination);
  }
  return path.join(outputDirectory, "index.html");
}
