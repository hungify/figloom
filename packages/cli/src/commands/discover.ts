import * as path from "node:path";

import type { Command } from "commander";

import { DEFAULT_DISCOVERY_DIR } from "@figloom/contracts";
import { JSON_INDENT_SPACES } from "@figloom/verify";
import { runDiscover } from "../discover.ts";
import { subcommand } from "./shared.ts";

interface DiscoverCommandOptions {
  projectRoot?: string;
  discoveryDir?: string;
  keepDiscovery?: boolean;
}

function discoverCommand(options: DiscoverCommandOptions): void {
  const result = runDiscover({
    projectRoot: path.resolve(options.projectRoot ?? process.cwd()),
    discoveryDir: options.discoveryDir,
    keepDiscovery: options.keepDiscovery,
  });
  console.log(
    JSON.stringify(
      {
        discoveredCount: result.discoveredCount,
        contracts: result.groups.map((group) => ({
          feature: group.feature,
          outputPath: group.outputPath,
          contractCount: group.request.contracts.length,
        })),
      },
      null,
      JSON_INDENT_SPACES,
    ),
  );
  if (result.groups.length === 0) {
    console.error("No recorded contracts found. Call visualContract() from an existing e2e test, then rerun that suite before discovering.");
  } else {
    console.error(`Wrote ${result.groups.length} contract file(s) from ${result.discoveredCount} recorded call(s). Run 'figloom verify --contract <path> --output <path>' on each.`);
  }
}

export function registerDiscoverCommand(program: Command): void {
  program.addCommand(
    subcommand("discover", "Turn visualContract() recordings from an existing e2e run into schema-v4 contracts.")
      .option("--project-root <dir>", "target project root")
      .option("--discovery-dir <dir>", `override the recorded-contracts directory (default: ${DEFAULT_DISCOVERY_DIR})`)
      .option("--keep-discovery", "do not delete recordings after writing contracts")
      .action(discoverCommand),
  );
}
