import * as path from "node:path";

import type { Command } from "commander";

import { JSON_INDENT_SPACES } from "@figloom/verify";
import { subcommand } from "./shared.ts";

export function registerStatusCommand(program: Command, packageVersion: string): void {
  program.addCommand(
    subcommand("status", "Print CLI capabilities and environment status.")
      .option("--project-root <dir>", "target project root")
      .action((options: { projectRoot?: string }) => {
        console.log(
          JSON.stringify(
            {
              ok: true,
              name: "figloom-verify",
              version: packageVersion,
              mode: "cli",
              baselineKinds: ["figma", "web"],
              projectRoot: path.resolve(options.projectRoot ?? process.cwd()),
              figmaTokenAvailable: Boolean(process.env.FIGMA_ACCESS_TOKEN),
            },
            null,
            JSON_INDENT_SPACES,
          ),
        );
      }),
  );
}
