import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { makeSolidPng, writePng } from "../src/compare/index.ts";
import { runVerification } from "../src/run.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "figloom-pipeline-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("source-agnostic verification pipeline", () => {
  it("fails final result when target capture is unstable", async () => {
    const outDir = path.join(tmp, "unstable-target");
    const baselinePath = path.join(outDir, "web-baseline.png");
    const metaPath = path.join(outDir, "web-baseline.meta.json");
    writePng(baselinePath, makeSolidPng(10, 10, [255, 255, 255, 255]));
    fs.writeFileSync(metaPath, JSON.stringify({ kind: "web" }));

    const result = await runVerification(
      {
        target: { kind: "web", url: "http://localhost:3000" },
        baseline: {
          evidence: {
            kind: "web",
            path: baselinePath,
            metaPath,
            url: "https://prod.example.com",
            revision: "git:abc123",
            capturedAt: "2026-08-01T00:00:00.000Z",
            stability: "stable",
          },
          warnings: [],
        },
        viewport: "desktop",
        viewportSize: { width: 10, height: 10 },
        profile: "page",
        pageReason: "Complete page.",
        runType: "final",
        outDir,
        stabilitySamples: 2,
      },
      {
        captureImpl: async ({ outPath }) => {
          const unstablePath = path.join(outDir, "unstable-sample.png");
          writePng(outPath, makeSolidPng(10, 10, [255, 255, 255, 255]));
          writePng(unstablePath, makeSolidPng(10, 10, [0, 0, 0, 255]));
          return {
            ok: true,
            capturePaths: [outPath, unstablePath],
            ephemeralSamplePaths: [unstablePath],
            capturedAt: "2026-08-01T00:00:01.000Z",
            elementRect: null,
            computedStyle: null,
            warnings: [],
          };
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pass).toBe(false);
      expect(result.topIssues).toContainEqual(expect.objectContaining({ kind: "capture-stability" }));
    }
  });
});
