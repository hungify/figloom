import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FigmaBaselineProvider, WebBaselineProvider } from "../src/baseline.ts";
import { makeSolidPng, writePng } from "../src/compare/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const contract = {
  id: "login.desktop",
  baseline: { kind: "web" as const, url: "https://prod.example.com/login", revision: "git:abc123" },
  viewport: { name: "desktop", width: 100, height: 80 },
  outDir: ".figloom/visual-verifications/login/desktop",
  scope: { kind: "page" as const, pageReason: "Complete screen." },
};

describe("baseline providers", () => {
  it("captures stable web baseline with URL and revision provenance", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "figloom-web-baseline-"));
    roots.push(root);
    const capture = vi.fn(async ({ outPath }: { outPath: string }) => {
      writePng(outPath, makeSolidPng(100, 80, [255, 255, 255, 255]));
      return {
        ok: true as const,
        capturePaths: [outPath, outPath],
        ephemeralSamplePaths: [],
        capturedAt: "2026-08-01T00:00:00.000Z",
        elementRect: null,
        computedStyle: null,
        warnings: [],
      };
    });
    const result = await new WebBaselineProvider(capture).resolve({
      source: contract.baseline,
      contract,
      outDir: root,
      profile: "page",
      stabilitySamples: 2,
    });
    expect(result).toMatchObject({
      ok: true,
      baseline: {
        evidence: {
          kind: "web",
          url: contract.baseline.url,
          revision: contract.baseline.revision,
          stability: "stable",
        },
      },
    });
    expect(fs.existsSync(path.join(root, "web-baseline.png"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(root, "web-baseline.meta.json"), "utf8"))).toMatchObject({
      kind: "web",
      revision: "git:abc123",
    });
  });

  it("maps Figma acquisition into common baseline evidence", async () => {
    const fetchGold = vi.fn().mockResolvedValue({
      ok: true,
      fetched: true,
      goldPath: "/tmp/figma-gold.png",
      metaPath: "/tmp/figma-gold.meta.json",
      meta: { fileKey: "file", nodeId: "1:2", fetchedAt: "2026-08-01T00:00:00.000Z", lastModified: null },
      warnings: [],
    });
    const provider = new FigmaBaselineProvider(fetchGold, vi.fn().mockResolvedValue([]));
    const figmaContract = { ...contract, baseline: { kind: "figma" as const, fileKey: "file", nodeId: "1:2" } };
    const result = await provider.resolve({
      source: figmaContract.baseline,
      contract: figmaContract,
      outDir: "/tmp",
      profile: "page",
      stabilitySamples: 3,
    });
    expect(result).toMatchObject({
      ok: true,
      baseline: {
        evidence: { kind: "figma", fileKey: "file", nodeId: "1:2" },
      },
    });
  });
});
