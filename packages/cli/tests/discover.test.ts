import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { visualContract, type VisualContractPage } from "@figloom/verify";
import { hostSegments, runDiscover } from "../src/discover.ts";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function tempProject(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "figloom-discover-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}

function fakePage(url: string, viewport: { width: number; height: number }): VisualContractPage {
  return { url: () => url, viewportSize: () => viewport };
}

const baseline = { kind: "figma" as const, fileKey: "abc", nodeId: "1:2" };

describe("figloom discover", () => {
  it("groups recordings for the same URL into one contract file and consumes the recordings", async () => {
    const projectRoot = tempProject();
    await visualContract(fakePage("http://127.0.0.1:3000/login", { width: 1440, height: 1024 }), {
      id: "login.desktop",
      baseline,
      viewportName: "desktop",
      projectRoot,
    });
    await visualContract(fakePage("http://127.0.0.1:3000/login", { width: 390, height: 844 }), {
      id: "login.mobile",
      baseline,
      viewportName: "mobile",
      projectRoot,
    });

    const result = runDiscover({ projectRoot });

    expect(result.discoveredCount).toBe(2);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ feature: "login" });
    expect(result.groups[0]!.request.contracts.map((contract) => contract.id).sort()).toEqual([
      "login.desktop",
      "login.mobile",
    ]);
    expect(fs.existsSync(result.groups[0]!.outputPath)).toBe(true);
    expect(fs.readdirSync(path.join(projectRoot, ".figloom", ".discovery"))).toHaveLength(0);
  });

  it("nests host/port only (no separate feature folder) — same depth as unlighthouse's own output", async () => {
    const projectRoot = tempProject();
    await visualContract(fakePage("http://127.0.0.1:3000/login", { width: 1440, height: 1024 }), {
      id: "login.desktop",
      baseline,
      projectRoot,
    });

    const result = runDiscover({ projectRoot });

    expect(result.groups[0]!.outputPath).toBe(
      path.join(projectRoot, ".figloom/visual-verifications/127.0.0.1/3000/login.visual-contract.json"),
    );
    expect(result.groups[0]!.request.contracts[0]!.outDir).toBe(
      ".figloom/visual-verifications/127.0.0.1/3000/login/desktop",
    );
  });

  it("splits distinct URLs into separate feature contract files", async () => {
    const projectRoot = tempProject();
    await visualContract(fakePage("http://127.0.0.1:3000/login", { width: 1440, height: 1024 }), {
      id: "login.desktop",
      baseline,
      projectRoot,
    });
    await visualContract(fakePage("http://127.0.0.1:3000/checkout", { width: 1440, height: 1024 }), {
      id: "checkout.desktop",
      baseline,
      projectRoot,
    });

    const result = runDiscover({ projectRoot });

    expect(result.groups.map((group) => group.feature).sort()).toEqual(["checkout", "login"]);
  });

  it("chunks more than MAX_CONTRACTS_PER_REQUEST recordings for the same URL into multiple files", async () => {
    const projectRoot = tempProject();
    for (let index = 0; index < 9; index += 1) {
      await visualContract(fakePage("http://127.0.0.1:3000/gallery", { width: 800, height: 600 }), {
        id: `gallery.state-${index}`,
        baseline,
        projectRoot,
      });
    }

    const result = runDiscover({ projectRoot });

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]!.request.contracts).toHaveLength(8);
    expect(result.groups[1]!.request.contracts).toHaveLength(1);
    expect(result.groups.every((group) => group.outputPath.includes("gallery"))).toBe(true);
  });

  it("keeps recordings on disk when --keep-discovery is set", async () => {
    const projectRoot = tempProject();
    await visualContract(fakePage("http://127.0.0.1:3000/login", { width: 1440, height: 1024 }), {
      id: "login.desktop",
      baseline,
      projectRoot,
    });

    runDiscover({ projectRoot, keepDiscovery: true });

    expect(fs.readdirSync(path.join(projectRoot, ".figloom", ".discovery"))).toHaveLength(1);
  });

  it("returns an empty result without writing anything when nothing was recorded", () => {
    const projectRoot = tempProject();
    const result = runDiscover({ projectRoot });
    expect(result).toEqual({ discoveredCount: 0, groups: [] });
    expect(fs.existsSync(path.join(projectRoot, ".figloom", "visual-verifications"))).toBe(false);
  });

  it("fails loudly instead of silently overwriting when a stale recording reuses an id", async () => {
    const projectRoot = tempProject();
    await visualContract(fakePage("http://127.0.0.1:3000/login", { width: 1440, height: 1024 }), {
      id: "login.desktop",
      baseline,
      projectRoot,
    });
    // Simulate a second, stale run that recorded under the same id without clearing first.
    await visualContract(fakePage("http://127.0.0.1:3000/login", { width: 1440, height: 1024 }), {
      id: "login.desktop",
      baseline,
      projectRoot,
    });

    expect(() => runDiscover({ projectRoot })).toThrow(/Duplicate discovered contract id "login.desktop"/);
  });

  it("keeps the same route verified against different environments from colliding", async () => {
    const projectRoot = tempProject();
    await visualContract(fakePage("http://localhost:3000/login", { width: 1440, height: 1024 }), {
      id: "login.desktop",
      baseline,
      projectRoot,
      discoveryDir: ".figloom/.discovery-local",
    });
    await visualContract(fakePage("https://staging.example.com/login", { width: 1440, height: 1024 }), {
      id: "login.desktop",
      baseline,
      projectRoot,
      discoveryDir: ".figloom/.discovery-staging",
    });

    const local = runDiscover({ projectRoot, discoveryDir: ".figloom/.discovery-local" });
    const staging = runDiscover({ projectRoot, discoveryDir: ".figloom/.discovery-staging" });

    expect(local.groups[0]!.outputPath).not.toBe(staging.groups[0]!.outputPath);
    expect(local.groups[0]!.outputPath).toContain(`${path.sep}localhost${path.sep}3000${path.sep}`);
    expect(staging.groups[0]!.outputPath).toContain(`${path.sep}staging.example.com${path.sep}`);
    expect(fs.existsSync(local.groups[0]!.outputPath)).toBe(true);
    expect(fs.existsSync(staging.groups[0]!.outputPath)).toBe(true);
    expect(local.groups[0]!.request.contracts[0]!.outDir).not.toBe(staging.groups[0]!.request.contracts[0]!.outDir);
  });

  it("keeps query-parameterized URLs on separate contract paths", async () => {
    const projectRoot = tempProject();
    await visualContract(fakePage("http://127.0.0.1:3000/login?locale=en", { width: 1440, height: 1024 }), {
      id: "login.desktop",
      baseline,
      projectRoot,
      discoveryDir: ".figloom/.discovery-en",
    });
    await visualContract(fakePage("http://127.0.0.1:3000/login?locale=fr", { width: 1440, height: 1024 }), {
      id: "login.desktop",
      baseline,
      projectRoot,
      discoveryDir: ".figloom/.discovery-fr",
    });

    const english = runDiscover({ projectRoot, discoveryDir: ".figloom/.discovery-en" });
    const french = runDiscover({ projectRoot, discoveryDir: ".figloom/.discovery-fr" });

    expect(english.groups[0]!.outputPath).not.toBe(french.groups[0]!.outputPath);
    expect(english.groups[0]!.outputPath).toMatch(/login\.q-[a-f0-9]{8}\.visual-contract\.json$/);
    expect(french.groups[0]!.outputPath).toMatch(/login\.q-[a-f0-9]{8}\.visual-contract\.json$/);
    expect(english.groups[0]!.request.contracts[0]!.outDir).not.toBe(french.groups[0]!.request.contracts[0]!.outDir);
    expect(english.groups[0]!.request.contracts[0]!.outDir).toContain("/login/q-");
  });

  it("rejects recordings that share a URL but disagree on target settings", async () => {
    const projectRoot = tempProject();
    await visualContract(fakePage("http://127.0.0.1:3000/login", { width: 1440, height: 1024 }), {
      id: "login.desktop",
      baseline,
      readySelector: "[data-testid=a]",
      projectRoot,
    });
    await visualContract(fakePage("http://127.0.0.1:3000/login", { width: 390, height: 844 }), {
      id: "login.mobile",
      baseline,
      readySelector: "[data-testid=b]",
      projectRoot,
    });

    expect(() => runDiscover({ projectRoot })).toThrow(/Incompatible target settings/);
  });
});

describe("hostSegments", () => {
  it("includes the port when the URL has an explicit non-default one", () => {
    expect(hostSegments("http://127.0.0.1:3000/login")).toEqual(["127.0.0.1", "3000"]);
    expect(hostSegments("http://localhost:8080/")).toEqual(["localhost", "8080"]);
  });

  it("omits the port segment when the URL has none", () => {
    expect(hostSegments("https://staging.example.com/login")).toEqual(["staging.example.com"]);
  });

  it("lowercases and sanitizes the hostname for filesystem safety", () => {
    expect(hostSegments("https://STAGING.Example.com/login")).toEqual(["staging.example.com"]);
  });
});
