import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SCHEMA_VERSION, type VerificationArtifact } from "@figloom/contracts";
import { projectArtifact } from "../src/dashboard/model.ts";
import { archivedDashboardSource, exportDashboardReport } from "../src/dashboard/report.ts";
import { startDashboardServer } from "../src/dashboard/server.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<{
  artifact: VerificationArtifact;
  clientRoot: string;
  root: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "figloom-dashboard-"));
  temporaryDirectories.push(root);
  const outDir = path.join(root, ".figloom/artifacts/visual-verifications/home");
  const clientRoot = path.join(root, "client");
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(clientRoot);
  await fs.writeFile(path.join(clientRoot, "index.html"), "<main>Figloom</main>");
  const baselinePath = path.join(outDir, "web-baseline.png");
  const actualPath = path.join(outDir, "actual.png");
  const diffPath = path.join(outDir, "diff.png");
  await fs.writeFile(baselinePath, Buffer.from([1, 2, 3]));
  await fs.writeFile(actualPath, Buffer.from([4, 5, 6]));
  await fs.writeFile(diffPath, Buffer.from([7, 8, 9]));
  await fs.writeFile(path.join(outDir, "visual-score.json"), JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    ok: true,
    pass: false,
    matchRatio: 0.98,
    ssim: 0.97,
    avgDeltaE: 2.4,
    fidelityScore: 91,
    diffPixels: 120,
    goldSize: { width: 320, height: 240 },
    actualSize: { width: 320, height: 240 },
    baseline: { kind: "web", path: baselinePath, url: "https://baseline.test", revision: "main" },
    target: { url: "https://actual.test" },
    selector: null,
    stability: "stable",
    evidenceHashes: {
      baseline: `sha256:${"a".repeat(64)}`,
      actual: `sha256:${"b".repeat(64)}`,
      diff: `sha256:${"c".repeat(64)}`,
    },
    artifacts: { baseline: baselinePath, actual: actualPath, diff: diffPath },
  }));
  const artifact: VerificationArtifact = {
    schemaVersion: SCHEMA_VERSION,
    kind: "figloom.visual-verification",
    createdAt: new Date().toISOString(),
    projectRoot: root,
    request: {
      schemaVersion: SCHEMA_VERSION,
      target: { kind: "web", url: "https://actual.test" },
      contracts: [{
        id: "home",
        baseline: { kind: "web", url: "https://baseline.test", revision: "main" },
        viewport: { name: "desktop", width: 320, height: 240 },
        outDir: ".figloom/artifacts/visual-verifications/home",
        scope: { kind: "page", pageReason: "release page" },
      }],
    },
    ok: true,
    allPassed: false,
    results: [{ id: "home", ok: true, pass: false, outDir }],
  };
  return { artifact, clientRoot, root };
}

describe("dashboard projection", () => {
  it("adapts canonical verification evidence without changing engine artifact", async () => {
    const { artifact } = await fixture();
    const projection = await projectArtifact(artifact);
    expect(projection.run).toMatchObject({
      status: "failed",
      summary: { total: 1, failed: 1 },
      contracts: [{
        id: "home",
        baselineKind: "web",
        capture: { kind: "viewport", viewport: { width: 320, height: 240 } },
        comparison: { matchRatio: 0.98, ssim: 0.97, diffPixels: 120 },
      }],
    });
    expect(projection.files.size).toBe(3);
  });

  it("rejects malformed score evidence instead of casting it into dashboard state", async () => {
    const { artifact } = await fixture();
    await fs.writeFile(
      path.join(artifact.results[0]!.outDir, "visual-score.json"),
      JSON.stringify({ pass: false }),
    );
    await expect(projectArtifact(artifact)).rejects.toThrow();
  });

  it("serves archived run and only allowlisted evidence files", async () => {
    const { artifact, clientRoot } = await fixture();
    const server = await startDashboardServer({ source: await archivedDashboardSource(artifact), clientRoot });
    try {
      expect(await (await fetch(`${server.url}/api/run`)).json()).toMatchObject({ status: "failed" });
      expect((await fetch(`${server.url}/artifacts/contracts/home/actual.png`)).status).toBe(200);
      expect((await fetch(`${server.url}/artifacts/not-allowlisted.png`)).status).toBe(404);
      expect(await (await fetch(`${server.url}/contracts/home`)).text()).toContain("Figloom");
    } finally {
      await server.close();
    }
  });

  it("exports portable report into empty directory", async () => {
    const { artifact, clientRoot, root } = await fixture();
    const outputDirectory = path.join(root, "report");
    const indexPath = await exportDashboardReport({ artifact, outputDirectory, clientRoot });
    expect(await fs.readFile(indexPath, "utf8")).toContain("Figloom");
    expect(JSON.parse(await fs.readFile(path.join(outputDirectory, "data/visual-verification.json"), "utf8")))
      .toMatchObject({ summary: { failed: 1 } });
    await expect(fs.access(path.join(outputDirectory, "data/contracts/home/diff.png"))).resolves.toBeUndefined();
  });
});
