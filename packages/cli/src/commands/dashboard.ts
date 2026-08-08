import * as path from "node:path";

import type { Command } from "commander";
import openBrowser from "open";

import { FIGLOOM_DIR } from "@figloom/contracts";
import { JSON_INDENT_SPACES } from "@figloom/verify";
import {
  aggregateDashboardSource,
  archivedDashboardSource,
  exportDashboardReport,
  readVerificationArtifact,
} from "../dashboard/report.ts";
import { startDashboardServer, waitForDashboardShutdown } from "../dashboard/server.ts";
import { subcommand } from "./shared.ts";

export async function runAggregatedDashboard(options: { projectRoot: string; open: boolean }): Promise<void> {
  const server = await startDashboardServer({ source: await aggregateDashboardSource(options.projectRoot) });
  try {
    console.error(`Dashboard: ${server.url}`);
    if (options.open) await openBrowser(server.url);
    await waitForDashboardShutdown();
  } finally {
    await server.close();
  }
}

async function openCommand(options: { artifact: string; open: boolean }): Promise<void> {
  const artifact = await readVerificationArtifact(options.artifact);
  const suiteName = path.basename(path.dirname(path.resolve(options.artifact)));
  const server = await startDashboardServer({ source: await archivedDashboardSource(artifact, suiteName) });
  try {
    console.error(`Dashboard: ${server.url}`);
    if (options.open) await openBrowser(server.url);
    await waitForDashboardShutdown();
  } finally {
    await server.close();
  }
}

async function reportCommand(options: { artifact: string; output: string }): Promise<void> {
  const artifact = await readVerificationArtifact(options.artifact);
  const suiteName = path.basename(path.dirname(path.resolve(options.artifact)));
  const indexPath = await exportDashboardReport({ artifact, suiteName, outputDirectory: options.output });
  console.log(
    JSON.stringify(
      { artifactPath: path.resolve(options.artifact), reportPath: indexPath },
      null,
      JSON_INDENT_SPACES,
    ),
  );
}

export function registerDashboardCommands(program: Command): void {
  program.addCommand(
    subcommand("dashboard", `Open dashboard aggregating every verification artifact under ${FIGLOOM_DIR}/.`)
      .option("--project-root <dir>", "target project root")
      .option("--no-open", "do not open dashboard in browser")
      .action((options: { projectRoot?: string; open: boolean }) =>
        runAggregatedDashboard({ projectRoot: path.resolve(options.projectRoot ?? process.cwd()), open: options.open }),
      ),
  );
  program.addCommand(
    subcommand("open", "Open dashboard for an existing verification artifact.")
      .requiredOption("--artifact <path>", "verification artifact JSON")
      .option("--no-open", "do not open dashboard in browser")
      .action(openCommand),
  );
  program.addCommand(
    subcommand("report", "Export a static dashboard report.")
      .requiredOption("--artifact <path>", "verification artifact JSON")
      .requiredOption("--output <dir>", "empty report output directory")
      .action(reportCommand),
  );
}
