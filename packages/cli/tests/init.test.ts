import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createInitRequest, writeInitRequest } from "../src/init.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("init scaffold", () => {
  it("creates a schema-valid Figma page contract", () => {
    const request = createInitRequest({
      targetUrl: "http://127.0.0.1:3000/login",
      contractId: "login.desktop",
      baseline: { kind: "figma", fileKey: "abc123", nodeId: "153:5181" },
      viewport: { name: "desktop", width: 1440, height: 1024 },
      scope: { kind: "page", pageReason: "Complete login page." },
    });

    expect(request).toMatchObject({
      schemaVersion: 4,
      target: { kind: "web", url: "http://127.0.0.1:3000/login" },
      contracts: [{ id: "login.desktop", outDir: ".figloom/artifacts/visual-verifications/login/desktop" }],
    });
  });

  it("writes nested output and refuses accidental overwrite", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "figloom-init-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, ".figloom", "visual-contract.json");
    const request = createInitRequest({
      targetUrl: "https://preview.example.com/card",
      contractId: "card.mobile",
      baseline: { kind: "web", url: "https://example.com/card", revision: "git:a1b2c3d" },
      viewport: { name: "mobile", width: 390, height: 844 },
      scope: { kind: "region", selector: "[data-testid=card]", expectSize: { width: 320, height: 240 } },
    });

    writeInitRequest(outputPath, request);

    expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toMatchObject({
      contracts: [{ profile: "component/strict" }],
    });
    expect(() => writeInitRequest(outputPath, request)).toThrow("Refusing to overwrite existing file");
    expect(() => writeInitRequest(outputPath, request, true)).not.toThrow();
  });
});
