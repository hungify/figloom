import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = (
  JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    version: string;
  }
).version;

describe("published CLI", () => {
  it("prints help successfully through the package bin", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin", "figloom.js"), "--help"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("figloom verify");
    expect(result.stderr).not.toContain("mcp");
  });

  it("reports CLI mode without requiring Figma access", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin", "figloom.js"), "status", "--project-root", packageRoot],
      { encoding: "utf8", env: { ...process.env, FIGMA_ACCESS_TOKEN: "" } },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      name: "figloom-verify",
      version: packageVersion,
      mode: "cli",
      projectRoot: packageRoot,
      baselineKinds: ["figma", "web"],
      figmaTokenAvailable: false,
    });
  });

  it.each([
    ["compare", ["--gold", "missing.png", "--actual", "missing.png", "--profile", "audit"]],
    [
      "run",
      [
        "--url",
        "http://127.0.0.1:3000",
        "--viewport",
        "desktop",
        "--viewport-size",
        "100x100",
        "--gold",
        "missing.png",
        "--out-dir",
        ".figloom/artifacts/visual-verifications/test",
        "--node-id",
        "1:2",
        "--run-type",
        "audit",
      ],
    ],
  ])("rejects invalid %s enum flags at usage boundary", (command, args) => {
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "bin", "figloom.js"), command, ...args],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });
});
