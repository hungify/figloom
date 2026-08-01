import { resolveToken } from "../fetch-gold.ts";
import { SPEC_SIZE_TOLERANCE_MIN_PX, SPEC_SIZE_TOLERANCE_PERCENT } from "../constants.ts";
import { getNodeMetadata } from "../figma-api.ts";
import type { TopIssue } from "../types.ts";

export interface SpecGateInput {
  fileKey: string;
  nodeId: string;
  domSize: { width: number; height: number };
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface SpecGateOutcome {
  pass: boolean | null;
  topIssues: TopIssue[];
  warnings: string[];
}

export function specSizeTolerance(figmaSize: number): number {
  return Math.max(SPEC_SIZE_TOLERANCE_MIN_PX, figmaSize * SPEC_SIZE_TOLERANCE_PERCENT);
}

export async function specGate(input: SpecGateInput): Promise<SpecGateOutcome> {
  const warnings: string[] = [];
  const token = resolveToken(input.token);
  if (!token) {
    return {
      pass: null,
      topIssues: [],
      warnings: ["spec-gate skipped: no Figma token to fetch the current node spec."],
    };
  }

  const meta = await getNodeMetadata(input.fileKey, input.nodeId, token, {
    fetchImpl: input.fetchImpl,
    cache: input.fetchImpl == null,
  });
  if ("error" in meta) {
    return {
      pass: null,
      topIssues: [],
      warnings: [
        `spec-gate skipped for this run (${meta.error}); visual verdict already computed against gold on disk.`,
      ],
    };
  }
  if (!meta.absoluteBoundingBox) {
    return {
      pass: null,
      topIssues: [],
      warnings: ["spec-gate skipped: node has no absoluteBoundingBox in Figma metadata."],
    };
  }

  const spec = meta.absoluteBoundingBox;
  const topIssues: TopIssue[] = [];
  const dw = Math.abs(input.domSize.width - spec.width);
  const dh = Math.abs(input.domSize.height - spec.height);

  if (dw > specSizeTolerance(spec.width) || dh > specSizeTolerance(spec.height)) {
    topIssues.push({
      severity: "high",
      kind: "spec-size-mismatch",
      message:
        `DOM element is ${input.domSize.width}x${input.domSize.height} but Figma spec ` +
        `(node ${input.nodeId}) says ${spec.width}x${spec.height} ` +
        `(tolerance max(${SPEC_SIZE_TOLERANCE_MIN_PX}px, ${SPEC_SIZE_TOLERANCE_PERCENT * 100}%)); code does not match the CURRENT Figma spec.`,
      hint: "Check width/height/padding/margin/box-sizing; this is structural, distinct from render-level areaGap.",
      repairCandidate: true,
    });
  }

  return { pass: topIssues.length === 0, topIssues, warnings };
}
