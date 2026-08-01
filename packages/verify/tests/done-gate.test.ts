import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkDoneGate, SCHEMA_VERSION } from "../src/index.ts";
import type { BaselineSource } from "@figloom/contracts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-donegate-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const target = { kind: "web" as const, url: "http://localhost:3000/login" };
const figmaBaseline = { kind: "figma" as const, fileKey: "file-key", nodeId: "153:5181" };
const webBaseline = { kind: "web" as const, url: "https://prod.example.com/login", revision: "git:abc123" };
const baseContract = {
  viewport: "desktop",
  outDir: "",
  baseline: figmaBaseline as BaselineSource,
  target,
  profile: "component/strict" as const,
  selector: '[data-testid="auth.login"]',
  expectSize: { width: 544, height: 464 },
};

let n = 0;
function scoreDir(baseline: BaselineSource = figmaBaseline, overrides: Record<string, unknown> = {}): string {
  const dir = path.join(tmp, `vp-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString();
  const names = baseline.kind === "figma"
    ? { image: "figma-gold.png", meta: "figma-gold.meta.json" }
    : { image: "web-baseline.png", meta: "web-baseline.meta.json" };
  const baselinePath = path.join(dir, names.image);
  const metaPath = path.join(dir, names.meta);
  for (const name of [names.image, "actual.png", "diff.png"]) fs.writeFileSync(path.join(dir, name), "fixture");
  const baselineEvidence = baseline.kind === "figma"
    ? { kind: "figma", path: baselinePath, metaPath, fileKey: baseline.fileKey, nodeId: baseline.nodeId, fetchedAt: timestamp, lastModified: null }
    : { kind: "web", path: baselinePath, metaPath, url: baseline.url, revision: baseline.revision, capturedAt: timestamp, stability: "stable" };
  const baselineMeta = baseline.kind === "figma"
    ? { fileKey: baseline.fileKey, nodeId: baseline.nodeId, fetchedAt: timestamp }
    : { kind: "web", url: baseline.url, revision: baseline.revision, capturedAt: timestamp, stability: "stable" };
  fs.writeFileSync(metaPath, JSON.stringify(baselineMeta));
  fs.writeFileSync(path.join(dir, "run-meta.json"), JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    target,
    baseline: baselineEvidence,
    viewport: "desktop",
    viewportSize: { width: 1440, height: 1024 },
    profile: "component/strict",
    pageReason: null,
    runType: "final",
  }));
  fs.writeFileSync(path.join(dir, "punch-list.json"), JSON.stringify({ schemaVersion: SCHEMA_VERSION, pass: true, items: [] }));
  const score = {
    schemaVersion: SCHEMA_VERSION,
    pass: true,
    runType: "final",
    capturedAt: timestamp,
    target,
    baseline: baselineEvidence,
    viewport: "desktop",
    profile: "component/strict",
    pageReason: null,
    selector: baseContract.selector,
    expectSize: baseContract.expectSize,
    stability: "stable",
    outDir: dir,
    evidenceHashes: {
      baseline: fileHash(baselinePath),
      baselineMeta: fileHash(metaPath),
      actual: fileHash(path.join(dir, "actual.png")),
      diff: fileHash(path.join(dir, "diff.png")),
    },
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, "visual-score.json"), JSON.stringify(score));
  return dir;
}

function fileHash(filePath: string): string {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function gate(outDir: string, baseline: BaselineSource = figmaBaseline, overrides: Record<string, unknown> = {}) {
  return checkDoneGate({ viewports: [{ ...baseContract, baseline, outDir, ...overrides }] });
}

describe("done gate schema v4", () => {
  it("accepts fresh Figma and web baseline evidence", () => {
    expect(gate(scoreDir()).done).toBe(true);
    expect(gate(scoreDir(webBaseline), webBaseline).done).toBe(true);
  });

  it("rejects missing, stale, future, dev, failing, and unstable evidence", () => {
    const empty = path.join(tmp, `vp-${n++}`);
    fs.mkdirSync(empty, { recursive: true });
    expect(gate(empty).done).toBe(false);
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    for (const testCase of [
      { overrides: { schemaVersion: 3 }, reason: /schemaVersion must be 4/ },
      { overrides: { runType: "dev" }, reason: /runType must be "final"/ },
      { overrides: { pass: false }, reason: /pass is not true/ },
      { overrides: { capturedAt: old }, reason: /capturedAt older than/ },
      { overrides: { capturedAt: future }, reason: /capturedAt is in future/ },
      { overrides: { stability: "borderline" }, reason: /stability must be "stable"/ },
    ]) {
      const result = gate(scoreDir(figmaBaseline, testCase.overrides));
      expect(result.done).toBe(false);
      expect(result.viewports[0]?.reasons.some((reason) => testCase.reason.test(reason))).toBe(true);
    }
    const webDir = scoreDir(webBaseline, { baseline: {
      kind: "web", path: "x", metaPath: "y", url: webBaseline.url, revision: webBaseline.revision,
      capturedAt: new Date().toISOString(), stability: "borderline",
    } });
    expect(gate(webDir, webBaseline).done).toBe(false);
  });

  it("rejects contract and baseline identity mismatches", () => {
    expect(gate(scoreDir(), figmaBaseline, { profile: "component/dev" }).done).toBe(false);
    expect(gate(scoreDir(), figmaBaseline, { selector: "[data-testid=other]" }).done).toBe(false);
    expect(gate(scoreDir(), { ...figmaBaseline, nodeId: "153:2364" }).done).toBe(false);
    expect(gate(scoreDir(webBaseline), { ...webBaseline, revision: "git:different" }).done).toBe(false);
  });

  it("rejects copied, incomplete, tampered, and residual-blocked artifacts", () => {
    expect(gate(scoreDir(figmaBaseline, { outDir: path.join(tmp, "other") })).done).toBe(false);
    const incomplete = scoreDir();
    fs.unlinkSync(path.join(incomplete, "diff.png"));
    expect(gate(incomplete).done).toBe(false);
    const tampered = scoreDir();
    fs.writeFileSync(path.join(tampered, "actual.png"), "tampered");
    expect(gate(tampered).done).toBe(false);
    const webTampered = scoreDir(webBaseline);
    fs.writeFileSync(path.join(webTampered, "web-baseline.meta.json"), "{}");
    expect(gate(webTampered, webBaseline).done).toBe(false);
    expect(gate(scoreDir(figmaBaseline, { topIssues: [{ kind: "residual", severity: "medium", message: "cluster" }] })).done).toBe(false);
  });

  it("resolves relative outDir against cwd", () => {
    const dir = scoreDir();
    const relative = path.relative(tmp, dir);
    const scorePath = path.join(dir, "visual-score.json");
    const score = JSON.parse(fs.readFileSync(scorePath, "utf8"));
    score.outDir = relative;
    fs.writeFileSync(scorePath, JSON.stringify(score));
    expect(checkDoneGate({ cwd: tmp, viewports: [{ ...baseContract, outDir: relative }] }).done).toBe(true);
  });
});
