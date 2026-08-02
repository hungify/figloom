import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { verificationArtifactSchema, type VerificationArtifact } from "@figloom/contracts";
import { projectArtifact } from "./model.ts";

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
    path.join(outputDirectory, "data", "visual-verification.json"),
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
