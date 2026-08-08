import * as fs from "node:fs";
import * as path from "node:path";

import {
  SCHEMA_VERSION,
  verificationRequestSchema,
  visualArtifactPath,
  type VerificationRequest,
} from "@figloom/contracts";

export interface ContractAnswers {
  targetUrl: string;
  expectedUrl?: string;
  readySelector?: string;
  auth?: "none" | "storageState";
  contractId: string;
  baseline:
    | { kind: "figma"; fileKey: string; nodeId: string }
    | { kind: "web"; url: string; revision: string };
  viewport: { name: string; width: number; height: number };
  scope:
    | { kind: "page"; pageReason: string }
    | { kind: "region"; selector: string; expectSize: { width: number; height: number } };
}

export function createContractRequest(answers: ContractAnswers): VerificationRequest {
  const outDirName = answers.contractId.replaceAll(".", "/");
  return verificationRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    target: {
      kind: "web",
      url: answers.targetUrl,
      ...(answers.expectedUrl ? { expectedUrl: answers.expectedUrl } : {}),
      ...(answers.readySelector ? { readySelector: answers.readySelector } : {}),
      ...(answers.auth ? { auth: answers.auth } : {}),
    },
    contracts: [
      {
        id: answers.contractId,
        baseline: answers.baseline,
        viewport: answers.viewport,
        outDir: visualArtifactPath(outDirName),
        scope: answers.scope,
        ...(answers.scope.kind === "region" ? { profile: "component/strict" as const } : {}),
      },
    ],
  });
}

export function writeContractRequest(
  outputPath: string,
  request: VerificationRequest,
  force = false,
): void {
  const resolved = path.resolve(outputPath);
  if (fs.existsSync(resolved) && !force) {
    throw new Error(`Refusing to overwrite existing file: ${resolved}. Pass --force to replace it.`);
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(request, null, 2)}\n`, "utf8");
}
