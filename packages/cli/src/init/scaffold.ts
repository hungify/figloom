import * as fs from "node:fs";
import * as path from "node:path";

import {
  SCHEMA_VERSION,
  verificationRequestSchema,
  type VerificationRequest,
} from "@figloom/contracts";

export interface InitAnswers {
  targetUrl: string;
  contractId: string;
  baseline:
    | { kind: "figma"; fileKey: string; nodeId: string }
    | { kind: "web"; url: string; revision: string };
  viewport: { name: string; width: number; height: number };
  scope:
    | { kind: "page"; pageReason: string }
    | { kind: "region"; selector: string; expectSize: { width: number; height: number } };
}

export function createInitRequest(answers: InitAnswers): VerificationRequest {
  const outDirName = answers.contractId.replaceAll(".", "/");
  return verificationRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    target: { kind: "web", url: answers.targetUrl },
    contracts: [
      {
        id: answers.contractId,
        baseline: answers.baseline,
        viewport: answers.viewport,
        outDir: `.figloom/artifacts/visual-verifications/${outDirName}`,
        scope: answers.scope,
        ...(answers.scope.kind === "region" ? { profile: "component/strict" as const } : {}),
      },
    ],
  });
}

export function writeInitRequest(
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
