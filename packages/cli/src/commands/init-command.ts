import * as path from "node:path";

import type { Command } from "commander";

import { runInit } from "../init.ts";
import { subcommand } from "./shared.ts";

export function registerInitCommand(program: Command): void {
  program.addCommand(
    subcommand("init", "Interactively scaffold a schema-v4 visual contract.")
      .option("--project-root <dir>", "target project root")
      .option("--output <path>", "contract path relative to project root")
      .option("--force", "replace existing contract")
      .action((options: { projectRoot?: string; output?: string; force?: boolean }) =>
        runInit({
          projectRoot: path.resolve(options.projectRoot ?? process.cwd()),
          outputPath: options.output,
          force: options.force,
        }),
      ),
  );
}
