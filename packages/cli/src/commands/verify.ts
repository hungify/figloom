import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { Command } from "commander";
import openBrowser from "open";

import { verificationRequestSchema } from "@figloom/contracts";
import { loadFigloomConfig } from "../config.ts";
import {
  EXIT_OK,
  EXIT_USAGE_ERROR,
  EXIT_VISUAL_FAIL,
  JSON_INDENT_SPACES,
  verify,
  writeVerificationArtifact,
} from "@figloom/verify";
import { LiveDashboardStore } from "../dashboard/model.ts";
import { exportDashboardReport } from "../dashboard/report.ts";
import {
  startDashboardServer,
  waitForDashboardShutdown,
  type DashboardServer,
} from "../dashboard/server.ts";
import { positiveInteger, subcommand } from "./shared.ts";

const MAX_DEFAULT_CONCURRENCY = 4;

function defaultConcurrency(): number {
  return Math.min(MAX_DEFAULT_CONCURRENCY, os.availableParallelism?.() ?? 2);
}

interface VerifyOptions {
  contract: string;
  output: string;
  projectRoot?: string;
  concurrency?: number;
  ui?: boolean;
  open: boolean;
}

function readContract(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(`Cannot read JSON ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function verifyCommand(options: VerifyOptions): Promise<void> {
  const request = verificationRequestSchema.parse(readContract(options.contract));
  for (const contract of request.contracts) {
    if (contract.profile === "component/dev") {
      console.error(
        `[warn] contract "${contract.id}" uses profile "component/dev"; figloom done-gate always rejects this profile; switch to "component/strict" before finalizing.`,
      );
    }
  }

  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const config = await loadFigloomConfig(projectRoot);
  const suiteName = path.basename(path.dirname(path.resolve(options.output)));
  const dashboardStore = options.ui ? new LiveDashboardStore(request, new Date(), suiteName) : undefined;
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
    if (options.open) await openBrowser(dashboardServer.url);
  }

  try {
    const artifact = await verify(request, {
      projectRoot,
      storageStatePath: config.resolvedStorageStatePath,
      maxConcurrency: options.concurrency ?? defaultConcurrency(),
      onProgress: ({ index, total, id, phase }) => {
        console.error(`[${index + 1}/${total}] ${id}: ${phase}`);
        dashboardStore?.progress(id, phase);
      },
    });
    writeVerificationArtifact(options.output, artifact);
    await dashboardStore?.finish(artifact);
    const resolvedOutput = path.resolve(options.output);
    const contentHash = `sha256:${crypto
      .createHash("sha256")
      .update(fs.readFileSync(resolvedOutput))
      .digest("hex")}`;

    const reportDir = path.join(path.dirname(resolvedOutput), "report");
    fs.rmSync(reportDir, { recursive: true, force: true });
    const reportIndexPath = await exportDashboardReport({ artifact, suiteName, outputDirectory: reportDir });
    console.error(`Static report: ${reportIndexPath}`);

    console.log(
      JSON.stringify({ ...artifact, artifactPath: resolvedOutput, contentHash, reportPath: reportIndexPath }, null, JSON_INDENT_SPACES),
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

export function registerVerifyCommand(program: Command): void {
  program.addCommand(
    subcommand("verify", "Run all contracts and write verification evidence.")
      .requiredOption("--contract <path>", "schema-v4 visual contract JSON")
      .requiredOption("--output <path>", "verification artifact output")
      .option("--project-root <dir>", "target project root")
      .option("--concurrency <n>", "max contracts to verify at once (default: min(4, CPU cores))", positiveInteger)
      .option("--ui", "serve live dashboard")
      .option("--no-open", "do not open dashboard in browser")
      .action(verifyCommand),
  );
}
