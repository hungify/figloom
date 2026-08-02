import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { verificationArtifactSchema, verificationRequestSchema } from "@figloom/contracts";
import { doneGateFromArtifact, verify, writeVerificationArtifact } from "../src/verify.ts";
import type { BaselineProvider } from "../src/baseline.ts";

const target = { kind: "web" as const, url: "http://127.0.0.1:3000/login" };
const pageContract = {
  id: "login.desktop",
  baseline: { kind: "figma" as const, fileKey: "file", nodeId: "1:2" },
  viewport: { name: "desktop", width: 1440, height: 1024 },
  outDir: ".figloom/artifacts/visual-verifications/login/desktop",
  scope: { kind: "page" as const, pageReason: "Complete supplied screen." },
};

function provider(outcome: Awaited<ReturnType<BaselineProvider["resolve"]>>): BaselineProvider {
  return { kind: "figma", resolve: vi.fn().mockResolvedValue(outcome) };
}

describe("schema-v4 verification contract", () => {
  it("runs provider then source-agnostic pipeline", async () => {
    const baseline = {
      evidence: {
        kind: "figma" as const,
        path: "/repo/figma-gold.png",
        metaPath: "/repo/figma-gold.meta.json",
        fileKey: "file",
        nodeId: "1:2",
        fetchedAt: "2026-08-01T00:00:00.000Z",
        lastModified: null,
      },
      warnings: [],
    };
    const phases: string[] = [];
    const runPipeline = vi.fn().mockImplementation(async (
      _input: unknown,
      dependencies?: { onPhase?: (phase: "compare" | "gates") => void },
    ) => {
      dependencies?.onPhase?.("compare");
      dependencies?.onPhase?.("gates");
      return { ok: true, pass: true };
    });
    const artifact = await verify(
      { schemaVersion: 4, target, contracts: [pageContract] },
      {
        projectRoot: "/repo",
        now: () => new Date("2026-08-01T00:00:00.000Z"),
        providerFor: () => provider({ ok: true, baseline }),
        runPipeline,
        onProgress: ({ phase }) => phases.push(phase),
      },
    );
    expect(artifact).toMatchObject({ schemaVersion: 4, ok: true, allPassed: true });
    expect(runPipeline.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ target, baseline, profile: "page", runType: "final", stabilitySamples: 3 }),
    );
    expect(phases).toEqual(["baseline", "capture", "compare", "gates", "complete"]);
  });

  it("does not apply configured storage state to public targets", async () => {
    const runPipeline = vi.fn().mockResolvedValue({ ok: true, pass: true });
    await verify(
      { schemaVersion: 4, target: { ...target, auth: "none" }, contracts: [pageContract] },
      {
        projectRoot: "/repo",
        storageStatePath: "/missing/user.json",
        providerFor: () => provider({
          ok: true,
          baseline: {
            evidence: {
              kind: "figma",
              path: "/repo/figma-gold.png",
              metaPath: "/repo/figma-gold.meta.json",
              fileKey: "file",
              nodeId: "1:2",
              fetchedAt: "2026-08-01T00:00:00.000Z",
              lastModified: null,
            },
            warnings: [],
          },
        }),
        runPipeline,
      },
    );

    expect(runPipeline.mock.calls[0]?.[0].storageStatePath).toBeUndefined();
  });

  it("rejects protected targets when storage state is not configured", async () => {
    const baselineProvider = provider({ ok: false, error: "unused", message: "unused" });
    const artifact = await verify(
      { schemaVersion: 4, target: { ...target, auth: "storageState" }, contracts: [pageContract] },
      { projectRoot: "/repo", providerFor: () => baselineProvider },
    );

    expect(artifact.results[0]).toMatchObject({ error: "STORAGE_STATE_NOT_CONFIGURED", pass: false });
    expect(baselineProvider.resolve).not.toHaveBeenCalled();
  });

  it("records provider failure without running pipeline", async () => {
    const runPipeline = vi.fn();
    const artifact = await verify(
      { schemaVersion: 4, target, contracts: [pageContract] },
      {
        projectRoot: "/repo",
        providerFor: () => provider({ ok: false, error: "BASELINE_FETCH_FAILED", message: "token rejected" }),
        runPipeline,
      },
    );
    expect(artifact).toMatchObject({ ok: false, allPassed: false });
    expect(artifact.results[0]).toMatchObject({ error: "BASELINE_FETCH_FAILED", pass: false });
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("invalidates stale verdict before baseline acquisition", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "figloom-provider-failure-"));
    const outDir = path.resolve(projectRoot, pageContract.outDir);
    fs.mkdirSync(outDir, { recursive: true });
    const scorePath = path.join(outDir, "visual-score.json");
    fs.writeFileSync(scorePath, JSON.stringify({ pass: true }));
    try {
      await verify(
        { schemaVersion: 4, target, contracts: [pageContract] },
        {
          projectRoot,
          providerFor: () => provider({ ok: false, error: "BASELINE_FETCH_FAILED", message: "offline" }),
        },
      );
      expect(fs.existsSync(scorePath)).toBe(false);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("accepts Figma and web baselines, rejects missing web revision", () => {
    expect(() => verificationRequestSchema.parse({ schemaVersion: 4, target, contracts: [pageContract] })).not.toThrow();
    const web = { ...pageContract, baseline: { kind: "web", url: "https://prod.example.com/login", revision: "git:abc123" } };
    expect(() => verificationRequestSchema.parse({ schemaVersion: 4, target, contracts: [web] })).not.toThrow();
    expect(() => verificationRequestSchema.parse({ schemaVersion: 4, target, contracts: [{ ...web, baseline: { ...web.baseline, revision: "" } }] })).toThrow();
    expect(() => verificationRequestSchema.parse({ schemaVersion: 4, target, contracts: [{ ...web, baseline: { ...web.baseline, url: "ftp://example.com/login" } }] })).toThrow(/http or https/);
  });

  it("accepts explicit target auth modes and rejects unknown modes", () => {
    expect(() => verificationRequestSchema.parse({ schemaVersion: 4, target: { ...target, auth: "none" }, contracts: [pageContract] })).not.toThrow();
    expect(() => verificationRequestSchema.parse({ schemaVersion: 4, target: { ...target, auth: "storageState" }, contracts: [pageContract] })).not.toThrow();
    expect(() => verificationRequestSchema.parse({ schemaVersion: 4, target: { ...target, auth: "cookies" }, contracts: [pageContract] })).toThrow();
  });

  it("rejects batches larger than eight contracts and duplicate ids", () => {
    expect(() => verificationRequestSchema.parse({ schemaVersion: 4, target, contracts: Array.from({ length: 9 }, (_, index) => ({ ...pageContract, id: `screen.${index}` })) })).toThrow();
    expect(() => verificationRequestSchema.parse({ schemaVersion: 4, target, contracts: [pageContract, pageContract] })).toThrow(/duplicate contract id/);
  });

  it("validates Figma-only render options", () => {
    expect(() => verificationRequestSchema.parse({ schemaVersion: 4, target, contracts: [{ ...pageContract, baseline: { ...pageContract.baseline, scale: 2 } }] })).toThrow();
    expect(() => verificationRequestSchema.parse({ schemaVersion: 4, target, contracts: [{ ...pageContract, baseline: { ...pageContract.baseline, scale: 1 } }] })).not.toThrow();
  });

  it("requires hideDevtoolsChrome when devtoolsMarker is set", () => {
    const request = { schemaVersion: 4, target, contracts: [{ ...pageContract, devtoolsMarker: "VITE DEVTOOLS" }] };
    expect(() => verificationRequestSchema.parse(request)).toThrow(/devtoolsMarker requires/);
    expect(() => verificationRequestSchema.parse({ ...request, contracts: [{ ...request.contracts[0], hideDevtoolsChrome: true }] })).not.toThrow();
  });

  it("keeps failed result blocked and rejects inconsistent aggregate", () => {
    const artifact = {
      schemaVersion: 4 as const,
      kind: "figloom.visual-verification" as const,
      createdAt: "2026-08-01T00:00:00.000Z",
      projectRoot: "/repo",
      request: { schemaVersion: 4 as const, target, contracts: [pageContract] },
      ok: true,
      allPassed: false,
      results: [{ id: pageContract.id, ok: true, pass: false, outDir: path.resolve("/repo", pageContract.outDir) }],
    };
    expect(doneGateFromArtifact(artifact).done).toBe(false);
    expect(() => verificationArtifactSchema.parse({ ...artifact, allPassed: true })).toThrow(/allPassed must equal/);
  });

  it("validates invariants before atomic artifact write", () => {
    const output = path.join(os.tmpdir(), `invalid-figloom-artifact-${process.pid}.json`);
    fs.rmSync(output, { force: true });
    const invalid = {
      schemaVersion: 4 as const,
      kind: "figloom.visual-verification" as const,
      createdAt: "2026-08-01T00:00:00.000Z",
      projectRoot: "/repo",
      request: { schemaVersion: 4 as const, target, contracts: [pageContract] },
      ok: true,
      allPassed: true,
      results: [{ id: pageContract.id, ok: true, pass: false, outDir: path.resolve("/repo", pageContract.outDir) }],
    };
    expect(() => writeVerificationArtifact(output, invalid)).toThrow(/allPassed must equal/);
    expect(fs.existsSync(output)).toBe(false);
  });
});
