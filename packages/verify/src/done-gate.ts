import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as z from "zod";

import {
  CLOCK_SKEW_MS,
  DEFAULT_MAX_BASELINE_AGE_MS,
  DEFAULT_MAX_GOLD_AGE_MS,
  DEFAULT_MAX_SCORE_AGE_MS,
  FIGMA_NODE_ID,
  MS_PER_HOUR,
  MS_PER_MINUTE,
} from "./constants.ts";
import type { BaselineSource, WebTarget } from "@figloom/contracts";
import { resolveArtifactPath } from "./paths.ts";
import type { ExpectSize, ProfileName } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

export { DEFAULT_MAX_BASELINE_AGE_MS, DEFAULT_MAX_GOLD_AGE_MS, DEFAULT_MAX_SCORE_AGE_MS };

export interface DoneGateViewport {
  viewport: string;
  outDir: string;
  baseline: BaselineSource;
  target: WebTarget;
  profile: ProfileName;
  selector?: string;
  expectSize?: ExpectSize;
  pageReason?: string;
}

export interface DoneGateOptions {
  viewports: DoneGateViewport[];
  maxScoreAgeMs?: number;
  maxBaselineAgeMs?: number;
  /** @deprecated Use maxBaselineAgeMs. */
  maxGoldAgeMs?: number;
  now?: () => number;
  cwd?: string;
}

export interface ViewportVerdict {
  viewport: string;
  done: boolean;
  reasons: string[];
}

export interface DoneGateVerdict {
  schemaVersion: typeof SCHEMA_VERSION;
  done: boolean;
  viewports: ViewportVerdict[];
}

const ExpectSizeSchema = z.object({ width: z.number(), height: z.number() });
const TopIssueSchema = z.object({
  kind: z.string().optional(),
  severity: z.string().optional(),
  message: z.string().optional(),
});
const FigmaEvidenceSchema = z.object({
  kind: z.literal("figma"),
  path: z.string(),
  metaPath: z.string(),
  fileKey: z.string(),
  nodeId: z.string(),
  fetchedAt: z.string(),
  lastModified: z.string().nullable(),
});
const WebEvidenceSchema = z.object({
  kind: z.literal("web"),
  path: z.string(),
  metaPath: z.string(),
  url: z.string(),
  revision: z.string(),
  capturedAt: z.string(),
  stability: z.enum(["stable", "borderline", "unknown"]),
});
const BaselineEvidenceSchema = z.discriminatedUnion("kind", [
  FigmaEvidenceSchema,
  WebEvidenceSchema,
]);
const ScoreFileSchema = z.object({
  schemaVersion: z.number(),
  pass: z.boolean(),
  runType: z.enum(["dev", "final"]),
  capturedAt: z.string(),
  target: z.object({ kind: z.literal("web"), url: z.string() }),
  baseline: BaselineEvidenceSchema,
  viewport: z.string(),
  profile: z.enum(["page", "component/strict", "component/dev"]),
  pageReason: z.string().nullable(),
  selector: z.string().nullable(),
  expectSize: ExpectSizeSchema.nullable(),
  stability: z.enum(["stable", "borderline", "unknown"]),
  outDir: z.string(),
  evidenceHashes: z.object({
    baseline: z.string(),
    baselineMeta: z.string(),
    actual: z.string(),
    diff: z.string().nullable(),
  }),
  topIssues: z.array(TopIssueSchema).optional(),
}).passthrough();

type ScoreFile = z.infer<typeof ScoreFileSchema>;

const RunMetaSchema = z.object({
  schemaVersion: z.number(),
  target: z.object({ kind: z.literal("web"), url: z.string() }),
  baseline: BaselineEvidenceSchema,
  viewport: z.string(),
  profile: z.string(),
  runType: z.string(),
  pageReason: z.string().nullable(),
  viewportSize: z.unknown(),
}).passthrough();
const PunchListSchema = z.object({
  schemaVersion: z.number(),
  pass: z.boolean(),
  items: z.array(z.unknown()),
}).passthrough();

export function checkDoneGate(options: DoneGateOptions): DoneGateVerdict {
  const maxAge = options.maxScoreAgeMs ?? DEFAULT_MAX_SCORE_AGE_MS;
  const maxBaselineAge =
    options.maxBaselineAgeMs ?? options.maxGoldAgeMs ?? DEFAULT_MAX_BASELINE_AGE_MS;
  const now = options.now?.() ?? Date.now();
  const cwd = options.cwd ?? process.cwd();

  const viewports = options.viewports.map((contract): ViewportVerdict => {
    const reasons = validateContract(contract);
    const outDir = resolveArtifactPath(contract.outDir, cwd);
    const scorePath = path.join(outDir, "visual-score.json");
    if (!fs.existsSync(scorePath)) {
      reasons.push(`missing visual-score.json at ${scorePath}.`);
      return verdict(contract.viewport, reasons);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(scorePath, "utf8"));
    } catch {
      reasons.push(`unreadable visual-score.json at ${scorePath}.`);
      return verdict(contract.viewport, reasons);
    }
    const parsed = ScoreFileSchema.safeParse(raw);
    if (!parsed.success) {
      reasons.push(`visual-score.json schema validation failed: ${parsed.error.message}`);
      return verdict(contract.viewport, reasons);
    }
    const score = parsed.data;

    if (score.schemaVersion !== SCHEMA_VERSION) reasons.push(`score schemaVersion must be ${SCHEMA_VERSION}.`);
    if (score.pass !== true) reasons.push("pass is not true.");
    if (score.runType !== "final") reasons.push('runType must be "final".');
    if (!sameTarget(score.target, contract.target)) reasons.push("target does not match contract.");
    if (!sameBaseline(score.baseline, contract.baseline)) reasons.push("baseline does not match contract.");
    if (score.viewport !== contract.viewport) reasons.push("viewport does not match contract.");
    if (score.profile !== contract.profile) reasons.push("profile does not match contract.");
    if (score.profile === "page" && !score.pageReason?.trim()) reasons.push("page score missing pageReason.");
    if (score.profile === "page" && score.pageReason !== contract.pageReason) reasons.push("pageReason does not match contract.");
    if ((score.selector ?? undefined) !== contract.selector) reasons.push("selector does not match contract.");
    if (!sameSize(score.expectSize, contract.expectSize)) reasons.push("expectSize does not match contract.");
    if (score.stability !== "stable") reasons.push('stability must be "stable".');
    if (score.baseline.kind === "web" && score.baseline.stability !== "stable") {
      reasons.push('web baseline stability must be "stable".');
    }
    if (!score.outDir || resolveArtifactPath(score.outDir, cwd) !== outDir) {
      reasons.push("score outDir does not match declared artifact directory.");
    }
    if (score.topIssues?.some((issue) => issue.kind === "residual" && (issue.severity === "medium" || issue.severity === "high"))) {
      reasons.push("blocking residual diff cluster remains.");
    }

    validateTimestamp(score.capturedAt, "capturedAt", now, maxAge, MS_PER_MINUTE, "min", reasons);
    const baselineTime = score.baseline.kind === "figma" ? score.baseline.fetchedAt : score.baseline.capturedAt;
    validateTimestamp(baselineTime, "baseline timestamp", now, maxBaselineAge, MS_PER_HOUR, "h", reasons);
    const capturedAtMs = Date.parse(score.capturedAt);
    const baselineAtMs = Date.parse(baselineTime);
    if (Number.isFinite(capturedAtMs) && Number.isFinite(baselineAtMs) && baselineAtMs > capturedAtMs + CLOCK_SKEW_MS) {
      reasons.push("baseline timestamp is later than target capture.");
    }

    const names = baselineFileNames(contract.baseline.kind);
    const expectedBaseline = path.join(outDir, names.image);
    const expectedMeta = path.join(outDir, names.meta);
    if (score.baseline.path !== expectedBaseline || score.baseline.metaPath !== expectedMeta) {
      reasons.push("baseline evidence paths do not match contract directory.");
    }
    for (const name of [names.image, names.meta, "actual.png", "diff.png", "run-meta.json", "punch-list.json"]) {
      if (!fs.existsSync(path.join(outDir, name))) reasons.push(`missing ${name}.`);
    }
    verifyRunArtifacts(outDir, contract, score, reasons);
    verifyBaselineMeta(expectedMeta, contract, score, reasons);
    verifyEvidenceHashes(outDir, names, score, reasons);
    return verdict(contract.viewport, reasons);
  });

  return { schemaVersion: SCHEMA_VERSION, done: viewports.every((item) => item.done), viewports };
}

function validateContract(contract: DoneGateViewport): string[] {
  const reasons: string[] = [];
  if (contract.target.kind !== "web" || !isUrl(contract.target.url)) reasons.push("valid web target required.");
  if (contract.baseline.kind === "figma") {
    if (!contract.baseline.fileKey) reasons.push("Figma baseline fileKey required.");
    if (!FIGMA_NODE_ID.test(contract.baseline.nodeId)) reasons.push("Figma baseline nodeId invalid.");
  } else {
    if (!isUrl(contract.baseline.url)) reasons.push("valid web baseline URL required.");
    if (!contract.baseline.revision.trim()) reasons.push("web baseline revision required.");
  }
  if (contract.profile === "component/dev") reasons.push("done gate forbids component/dev; use component/strict for final contract.");
  if (contract.profile === "page") {
    if (!contract.pageReason?.trim()) reasons.push("page contract requires pageReason.");
    if (contract.selector) reasons.push("page contract must not set selector.");
    if (contract.expectSize) reasons.push("page contract must not set expectSize.");
  } else {
    if (!contract.selector) reasons.push("component contract requires selector.");
    if (contract.profile === "component/strict" && !contract.expectSize) reasons.push("component/strict contract requires expectSize.");
  }
  return reasons;
}

function verifyRunArtifacts(outDir: string, contract: DoneGateViewport, score: ScoreFile, reasons: string[]): void {
  try {
    const parsed = RunMetaSchema.safeParse(JSON.parse(fs.readFileSync(path.join(outDir, "run-meta.json"), "utf8")));
    if (!parsed.success) reasons.push("run-meta.json schema validation failed.");
    else {
      const meta = parsed.data;
      if (meta.schemaVersion !== SCHEMA_VERSION) reasons.push("run-meta schemaVersion mismatch.");
      if (!sameTarget(meta.target, contract.target)) reasons.push("run-meta target mismatch.");
      if (!sameBaseline(meta.baseline, contract.baseline)) reasons.push("run-meta baseline mismatch.");
      if (meta.viewport !== contract.viewport || meta.profile !== contract.profile) reasons.push("run-meta viewport/profile mismatch.");
      if (meta.runType !== "final") reasons.push("run-meta runType must be final.");
      if (contract.profile === "page" && meta.pageReason !== contract.pageReason) reasons.push("run-meta pageReason mismatch.");
      if (!meta.viewportSize || typeof meta.viewportSize !== "object") reasons.push("run-meta viewportSize missing.");
    }
  } catch {
    reasons.push("run-meta.json unreadable or invalid.");
  }
  try {
    const parsed = PunchListSchema.safeParse(JSON.parse(fs.readFileSync(path.join(outDir, "punch-list.json"), "utf8")));
    if (!parsed.success) reasons.push("punch-list.json schema validation failed.");
    else {
      if (parsed.data.schemaVersion !== SCHEMA_VERSION) reasons.push("punch-list schemaVersion mismatch.");
      if (parsed.data.pass !== score.pass) reasons.push("punch-list pass does not match score.");
    }
  } catch {
    reasons.push("punch-list.json unreadable or invalid.");
  }
}

function verifyBaselineMeta(metaPath: string, contract: DoneGateViewport, score: ScoreFile, reasons: string[]): void {
  if (!fs.existsSync(metaPath)) return;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    if (contract.baseline.kind === "figma") {
      if (meta.fileKey !== contract.baseline.fileKey || meta.nodeId !== contract.baseline.nodeId) reasons.push("Figma baseline metadata identity mismatch.");
      if (score.baseline.kind !== "figma" || meta.fetchedAt !== score.baseline.fetchedAt) reasons.push("Figma baseline timestamp evidence mismatch.");
    } else {
      if (meta.kind !== "web" || meta.url !== contract.baseline.url || meta.revision !== contract.baseline.revision) reasons.push("web baseline metadata identity mismatch.");
      if (score.baseline.kind !== "web" || meta.capturedAt !== score.baseline.capturedAt || meta.stability !== score.baseline.stability) reasons.push("web baseline capture evidence mismatch.");
    }
  } catch {
    reasons.push("baseline metadata unreadable.");
  }
}

function verifyEvidenceHashes(outDir: string, names: { image: string; meta: string }, score: ScoreFile, reasons: string[]): void {
  const files = { baseline: names.image, baselineMeta: names.meta, actual: "actual.png", diff: "diff.png" } as const;
  for (const key of Object.keys(files) as Array<keyof typeof files>) {
    const name = files[key];
    const filePath = path.join(outDir, name);
    if (!fs.existsSync(filePath)) continue;
    const actual = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
    if (!score.evidenceHashes[key] || score.evidenceHashes[key] !== actual) reasons.push(`${name} hash does not match score.`);
  }
}

function sameBaseline(evidence: ScoreFile["baseline"], source: BaselineSource): boolean {
  return source.kind === "figma"
    ? evidence.kind === "figma" && evidence.fileKey === source.fileKey && evidence.nodeId === source.nodeId
    : evidence.kind === "web" && evidence.url === source.url && evidence.revision === source.revision;
}

function sameTarget(actual: { kind: "web"; url: string }, expected: WebTarget): boolean {
  return actual.kind === expected.kind && actual.url === expected.url;
}

function baselineFileNames(kind: BaselineSource["kind"]): { image: string; meta: string } {
  return kind === "figma"
    ? { image: "figma-gold.png", meta: "figma-gold.meta.json" }
    : { image: "web-baseline.png", meta: "web-baseline.meta.json" };
}

function validateTimestamp(value: string, label: string, now: number, maxAge: number, unitMs: number, unit: string, reasons: string[]): void {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) reasons.push(`${label} missing/unparseable.`);
  else if (timestamp > now + CLOCK_SKEW_MS) reasons.push(`${label} is in future.`);
  else if (now - timestamp > maxAge) reasons.push(`${label} older than ${Math.round(maxAge / unitMs)}${unit}.`);
}

function sameSize(actual: ExpectSize | null | undefined, expected?: ExpectSize): boolean {
  if (!actual && !expected) return true;
  return actual?.width === expected?.width && actual?.height === expected?.height;
}

function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function verdict(viewport: string, reasons: string[]): ViewportVerdict {
  return { viewport, done: reasons.length === 0, reasons };
}
