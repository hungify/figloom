import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";
import openBrowser from "open";

import {
  profileSchema,
  runTypeSchema,
  verificationArtifactSchema,
  verificationRequestSchema,
} from "@figloom/contracts";
import {
  compare,
  DEFAULT_IMAGE_SCALE,
  doneGateFromArtifact,
  EXIT_OK,
  EXIT_USAGE_ERROR,
  EXIT_VISUAL_FAIL,
  fetchGold,
  JSON_INDENT_SPACES,
  loadAncestorEnv,
  run,
  verify,
  writeVerificationArtifact,
} from "@figloom/verify";
import { LiveDashboardStore } from "./dashboard/model.ts";
import {
  archivedDashboardSource,
  exportDashboardReport,
  readVerificationArtifact,
} from "./dashboard/report.ts";
import {
  startDashboardServer,
  waitForDashboardShutdown,
  type DashboardServer,
} from "./dashboard/server.ts";

loadAncestorEnv();

const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

function arg(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function usage(exitCode: number = EXIT_USAGE_ERROR): never {
  console.error(`Usage:
  figloom verify --contract <visual-contract.json> --output <visual-verification.json> [--project-root <dir>] [--ui] [--no-open]
  figloom open --artifact <visual-verification.json> [--no-open]
  figloom report --artifact <visual-verification.json> --output <empty-dir>
  figloom done-gate --artifact <visual-verification.json> [--max-score-age-ms <ms>] [--max-baseline-age-ms <ms>]
  figloom status [--project-root <dir>]

Figma debug commands:
  figloom fetch-gold --file-key <key> --node-id <id> --out <figma-gold.png> [--scale 1] [--canvas-fill '#fff']
  figloom compare --gold <png> --actual <png> --out-dir <dir> [--profile component/strict]
  figloom run --url <url> --viewport <name> --viewport-size WxH --gold <png> --out-dir <dir>
              --node-id <id> [--selector <css>] [--profile <profile>] [--page-reason <reason>]
              [--run-type dev|final] [--expect-width <px> --expect-height <px>]
              [--stability-samples <n>] [--timeout-ms <ms>] [--hide-devtools-chrome]
              [--devtools-marker <text>]
`);
  process.exit(exitCode);
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(`Cannot read JSON ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function cmdVerify(argv: string[]): Promise<void> {
  const contractPath = arg(argv, "--contract");
  const outputPath = arg(argv, "--output");
  if (!contractPath || !outputPath) usage();
  const request = verificationRequestSchema.parse(readJson(contractPath));
  for (const contract of request.contracts) {
    if (contract.profile === "component/dev") {
      console.error(
        `[warn] contract "${contract.id}" uses profile "component/dev"; figloom done-gate always rejects this profile; switch to "component/strict" before finalizing.`,
      );
    }
  }
  const projectRoot = path.resolve(arg(argv, "--project-root") ?? process.cwd());
  const wantsUi = argv.includes("--ui");
  const dashboardStore = wantsUi ? new LiveDashboardStore(request) : undefined;
  let dashboardServer: DashboardServer | undefined;
  if (dashboardStore) {
    dashboardServer = await startDashboardServer({
      source: {
        snapshot: () => dashboardStore.snapshot(),
        files: () => dashboardStore.files(),
        subscribe: (listener) => dashboardStore.subscribe(listener),
      },
    });
    console.error(`Dashboard: ${dashboardServer.url}`);
    if (!argv.includes("--no-open")) await openBrowser(dashboardServer.url);
  }
  try {
    const artifact = await verify(request, {
      projectRoot,
      onProgress: ({ index, total, id, phase }) => {
        console.error(`[${index + 1}/${total}] ${id}: ${phase}`);
        dashboardStore?.progress(id, phase);
      },
    });
    writeVerificationArtifact(outputPath, artifact);
    await dashboardStore?.finish(artifact);
    const resolvedOutput = path.resolve(outputPath);
    const contentHash = `sha256:${crypto
      .createHash("sha256")
      .update(fs.readFileSync(resolvedOutput))
      .digest("hex")}`;
    console.log(
      JSON.stringify({ ...artifact, artifactPath: resolvedOutput, contentHash }, null, JSON_INDENT_SPACES),
    );
    process.exitCode = !artifact.ok
      ? EXIT_USAGE_ERROR
      : artifact.allPassed
        ? EXIT_OK
        : EXIT_VISUAL_FAIL;
    if (dashboardServer) {
      console.error("Dashboard remains available until Ctrl+C.");
      await waitForDashboardShutdown();
    }
  } finally {
    await dashboardServer?.close();
  }
}

async function cmdOpen(argv: string[]): Promise<void> {
  const artifactPath = arg(argv, "--artifact");
  if (!artifactPath) usage();
  const artifact = await readVerificationArtifact(artifactPath);
  const server = await startDashboardServer({ source: await archivedDashboardSource(artifact) });
  try {
    console.error(`Dashboard: ${server.url}`);
    if (!argv.includes("--no-open")) await openBrowser(server.url);
    await waitForDashboardShutdown();
  } finally {
    await server.close();
  }
}

async function cmdReport(argv: string[]): Promise<void> {
  const artifactPath = arg(argv, "--artifact");
  const outputDirectory = arg(argv, "--output");
  if (!artifactPath || !outputDirectory) usage();
  const artifact = await readVerificationArtifact(artifactPath);
  const indexPath = await exportDashboardReport({ artifact, outputDirectory });
  console.log(JSON.stringify({ artifactPath: path.resolve(artifactPath), reportPath: indexPath }, null, JSON_INDENT_SPACES));
}

async function cmdDoneGate(argv: string[]): Promise<void> {
  const artifactPath = arg(argv, "--artifact");
  if (!artifactPath) usage();
  const artifact = verificationArtifactSchema.parse(readJson(artifactPath));
  const verdict = doneGateFromArtifact(artifact, {
    maxScoreAgeMs: optionalNumber(argv, "--max-score-age-ms"),
    maxBaselineAgeMs:
      optionalNumber(argv, "--max-baseline-age-ms") ?? optionalNumber(argv, "--max-gold-age-ms"),
  });
  console.log(JSON.stringify({ artifactPath: path.resolve(artifactPath), ...verdict }, null, JSON_INDENT_SPACES));
  process.exitCode = verdict.done ? EXIT_OK : EXIT_VISUAL_FAIL;
}

async function cmdStatus(argv: string[]): Promise<void> {
  const projectRoot = path.resolve(arg(argv, "--project-root") ?? process.cwd());
  console.log(
    JSON.stringify(
      {
        ok: true,
        name: "figloom-verify",
        version: PACKAGE_VERSION,
        mode: "cli",
        baselineKinds: ["figma", "web"],
        projectRoot,
        figmaTokenAvailable: Boolean(process.env.FIGMA_ACCESS_TOKEN),
      },
      null,
      JSON_INDENT_SPACES,
    ),
  );
}

async function cmdFetchGold(argv: string[]): Promise<void> {
  const fileKey = arg(argv, "--file-key");
  const nodeId = arg(argv, "--node-id");
  const outPath = arg(argv, "--out");
  if (!fileKey || !nodeId || !outPath) usage();
  const result = await fetchGold({
    fileKey,
    nodeId,
    outPath,
    scale: optionalNumber(argv, "--scale") ?? DEFAULT_IMAGE_SCALE,
    canvasFill: arg(argv, "--canvas-fill"),
  });
  console.log(JSON.stringify(result, null, JSON_INDENT_SPACES));
  process.exitCode = result.ok ? EXIT_OK : EXIT_VISUAL_FAIL;
}

async function cmdCompare(argv: string[]): Promise<void> {
  const gold = arg(argv, "--gold");
  const actual = arg(argv, "--actual");
  const outDir = arg(argv, "--out-dir") ?? (actual ? path.dirname(actual) : undefined);
  if (!gold || !actual || !outDir) usage();
  const profile = profileSchema.safeParse(arg(argv, "--profile") ?? "component/strict");
  if (!profile.success) usage();
  const result = compare(gold, actual, outDir, { profile: profile.data });
  console.log(JSON.stringify(result, null, JSON_INDENT_SPACES));
  process.exitCode = result.pass ? EXIT_OK : EXIT_VISUAL_FAIL;
}

async function cmdRun(argv: string[]): Promise<void> {
  const url = arg(argv, "--url");
  const viewport = arg(argv, "--viewport");
  const viewportSize = arg(argv, "--viewport-size");
  const goldPath = arg(argv, "--gold");
  const outDir = arg(argv, "--out-dir");
  const nodeId = arg(argv, "--node-id");
  if (!url || !viewport || !viewportSize || !goldPath || !outDir || !nodeId) usage();
  const viewportMatch = /^(\d+)x(\d+)$/.exec(viewportSize);
  const width = Number(viewportMatch?.[1]);
  const height = Number(viewportMatch?.[2]);
  if (
    !viewportMatch ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) usage();
  const profileRaw = arg(argv, "--profile");
  const profile = profileRaw == null ? undefined : profileSchema.safeParse(profileRaw);
  if (profile && !profile.success) usage();
  const runType = runTypeSchema.safeParse(arg(argv, "--run-type") ?? "dev");
  if (!runType.success) usage();
  const devtoolsMarker = arg(argv, "--devtools-marker");
  if (devtoolsMarker != null && !argv.includes("--hide-devtools-chrome")) usage();
  const expectWidth = optionalNumber(argv, "--expect-width");
  const expectHeight = optionalNumber(argv, "--expect-height");
  if (Boolean(expectWidth) !== Boolean(expectHeight)) usage();
  const result = await run({
    url,
    viewport,
    viewportSize: { width, height },
    goldPath,
    outDir,
    nodeId,
    selector: arg(argv, "--selector"),
    profile: profile?.data,
    pageReason: arg(argv, "--page-reason"),
    runType: runType.data,
    expectSize:
      expectWidth && expectHeight ? { width: expectWidth, height: expectHeight } : undefined,
    stabilitySamples: optionalNumber(argv, "--stability-samples"),
    timeoutMs: optionalNumber(argv, "--timeout-ms"),
    hideDevtoolsChrome: argv.includes("--hide-devtools-chrome"),
    devtoolsMarker,
  });
  console.log(JSON.stringify(result, null, JSON_INDENT_SPACES));
  process.exitCode = !result.ok ? EXIT_USAGE_ERROR : result.pass ? EXIT_OK : EXIT_VISUAL_FAIL;
}

function optionalNumber(argv: string[], flag: string): number | undefined {
  const raw = arg(argv, flag);
  if (raw == null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} must be a positive number`);
  return value;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const command = argv[0];
  if (command === "-h" || command === "--help") usage(EXIT_OK);
  if (!command) usage();
  const rest = argv.slice(1);
  switch (command) {
    case "verify":
      await cmdVerify(rest);
      return;
    case "done-gate":
      await cmdDoneGate(rest);
      return;
    case "open":
      await cmdOpen(rest);
      return;
    case "report":
      await cmdReport(rest);
      return;
    case "status":
      await cmdStatus(rest);
      return;
    case "fetch-gold":
      await cmdFetchGold(rest);
      return;
    case "compare":
      await cmdCompare(rest);
      return;
    case "run":
      await cmdRun(rest);
      return;
    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}

const isMain =
  process.argv[1] != null &&
  (process.argv[1].endsWith("/cli.ts") ||
    process.argv[1].endsWith("/cli.js") ||
    process.argv[1].endsWith("figloom.js"));

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = EXIT_USAGE_ERROR;
  });
}
