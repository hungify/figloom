import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { readDiscoveredContracts, visualContract, type VisualContractPage } from "../src/discover.ts";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figloom-discover-"));
  cleanupDirs.push(dir);
  return dir;
}

function fakePage(url: string, viewport: { width: number; height: number } | null): VisualContractPage {
  return { url: () => url, viewportSize: () => viewport };
}

const baseline = { kind: "figma" as const, fileKey: "file", nodeId: "1:2" };

describe("visualContract", () => {
  it("records the page's real resolved URL and viewport, not a guess", async () => {
    const projectRoot = tempProject();
    const record = await visualContract(fakePage("http://127.0.0.1:4000/login?locale=en", { width: 1440, height: 1024 }), {
      id: "login.desktop",
      baseline,
      projectRoot,
    });
    expect(record).toMatchObject({
      id: "login.desktop",
      url: "http://127.0.0.1:4000/login?locale=en",
      viewport: { name: "1440x1024", width: 1440, height: 1024 },
      scope: { kind: "page" },
    });
    const files = fs.readdirSync(path.join(projectRoot, ".figloom", ".discovery"));
    expect(files).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".figloom", ".discovery", files[0]!), "utf8"))).toMatchObject({
      id: "login.desktop",
    });
  });

  it("uses viewportName when given instead of the pixel-derived default", async () => {
    const projectRoot = tempProject();
    const record = await visualContract(fakePage("http://127.0.0.1:4000/", { width: 390, height: 844 }), {
      id: "home.mobile",
      baseline,
      viewportName: "mobile",
      projectRoot,
    });
    expect(record.viewport.name).toBe("mobile");
  });

  it("rejects a page with no viewport size instead of writing a broken record", async () => {
    const projectRoot = tempProject();
    await expect(
      visualContract(fakePage("http://127.0.0.1:4000/", null), { id: "home.desktop", baseline, projectRoot }),
    ).rejects.toThrow(/viewport size/);
    expect(fs.existsSync(path.join(projectRoot, ".figloom", ".discovery"))).toBe(false);
  });

  it("writes one file per call so concurrent Playwright workers never race on the same file", async () => {
    const projectRoot = tempProject();
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        visualContract(fakePage(`http://127.0.0.1:4000/page-${index}`, { width: 800, height: 600 }), {
          id: `page-${index}.desktop`,
          baseline,
          projectRoot,
        }),
      ),
    );
    expect(fs.readdirSync(path.join(projectRoot, ".figloom", ".discovery"))).toHaveLength(5);
  });
});

describe("readDiscoveredContracts", () => {
  it("returns an empty array when the discovery directory does not exist", () => {
    expect(readDiscoveredContracts(path.join(tempProject(), ".figloom", ".discovery"))).toEqual([]);
  });

  it("parses and validates every recorded file", async () => {
    const projectRoot = tempProject();
    const dir = path.join(projectRoot, ".figloom", ".discovery");
    await visualContract(fakePage("http://127.0.0.1:4000/a", { width: 800, height: 600 }), {
      id: "a.desktop",
      baseline,
      projectRoot,
    });
    await visualContract(fakePage("http://127.0.0.1:4000/b", { width: 800, height: 600 }), {
      id: "b.desktop",
      baseline,
      projectRoot,
    });
    const files = readDiscoveredContracts(dir);
    expect(files).toHaveLength(2);
    expect(files.map((file) => file.record.id).sort()).toEqual(["a.desktop", "b.desktop"]);
  });

  it("throws with the file path when a record is invalid", () => {
    const dir = path.join(tempProject(), ".figloom", ".discovery");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "broken.json"), JSON.stringify({ id: "not-enough-fields" }));
    expect(() => readDiscoveredContracts(dir)).toThrow(/Invalid discovered contract.*broken\.json/);
  });

  it("throws with the file path when a record is not valid JSON", () => {
    const dir = path.join(tempProject(), ".figloom", ".discovery");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "corrupt.json"), "{not json");
    expect(() => readDiscoveredContracts(dir)).toThrow(/Cannot parse discovered contract.*corrupt\.json/);
  });
});

describe("discover.ts module isolation", () => {
  it("never imports @playwright/test", () => {
    // visualContract() is meant to be imported into a consumer's own Playwright test file
    // (import { visualContract } from "@figloom/verify/discover"). If this module ever
    // imports @playwright/test itself, that pulls in figloom's own copy alongside the
    // consumer's — Playwright's test runner refuses to start with two instances loaded
    // ("Requiring @playwright/test second time"). Source-scan instead of just relying on
    // "it works in this repo's tests", since this repo doesn't otherwise exercise being
    // imported from a separate Playwright process the way a real consumer would.
    const source = fs.readFileSync(fileURLToPath(new URL("../src/discover.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/@playwright\/test/);
  });
});
