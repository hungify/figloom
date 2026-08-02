import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { Command } from "commander";
import openBrowser from "open";

import { verificationRequestSchema } from "@figloom/contracts";
import {
  EXIT_OK,
  EXIT_USAGE_ERROR,
  EXIT_VISUAL_FAIL,
  JSON_INDENT_SPACES,
  verify,
  writeVerificationArtifact,
} from "@figloom/verify";
import { LiveDashboardStore } from "../dashboard/model.ts";
import {
  startDashboardServer,
  waitForDashboardShutdown,
  type DashboardServer,
} from "../dashboard/server.ts";
import { subcommand } from "./shared.ts";

interface VerifyOptions {
  contract: string;
  output: string;
  projectRoot?: string;
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

export function registerVerifyCommand(program: Command): void {
  program.addCommand(
    subcommand("verify", "Run all contracts and write verification evidence.")
      .requiredOption("--contract <path>", "schema-v4 visual contract JSON")
      .requiredOption("--output <path>", "verification artifact output")
      .option("--project-root <dir>", "target project root")
      .option("--ui", "serve live dashboard")
      .option("--no-open", "do not open dashboard in browser")
      .action(verifyCommand),
  );
}
