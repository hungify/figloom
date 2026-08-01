import * as path from "node:path";

import { Option, type Command } from "commander";

import {
  compare,
  DEFAULT_IMAGE_SCALE,
  EXIT_OK,
  EXIT_VISUAL_FAIL,
  fetchGold,
  JSON_INDENT_SPACES,
} from "@figloom/verify";
import { positiveNumber, subcommand } from "./shared.ts";

type Profile = "component/strict" | "component/dev" | "page";

async function fetchGoldCommand(options: {
  fileKey: string;
  nodeId: string;
  out: string;
  scale?: number;
  canvasFill?: string;
}): Promise<void> {
  const result = await fetchGold({
    fileKey: options.fileKey,
    nodeId: options.nodeId,
    outPath: options.out,
    scale: options.scale ?? DEFAULT_IMAGE_SCALE,
    canvasFill: options.canvasFill,
  });
  console.log(JSON.stringify(result, null, JSON_INDENT_SPACES));
  process.exitCode = result.ok ? EXIT_OK : EXIT_VISUAL_FAIL;
}

async function compareCommand(options: {
  gold: string;
  actual: string;
  outDir?: string;
  profile: Profile;
}): Promise<void> {
  const result = compare(options.gold, options.actual, options.outDir ?? path.dirname(options.actual), {
    profile: options.profile,
  });
  console.log(JSON.stringify(result, null, JSON_INDENT_SPACES));
  process.exitCode = result.pass ? EXIT_OK : EXIT_VISUAL_FAIL;
}

export function registerDebugCommands(program: Command): void {
  program.addCommand(
    subcommand("fetch-gold", "Fetch a Figma node baseline image.")
      .requiredOption("--file-key <key>", "Figma file key")
      .requiredOption("--node-id <id>", "Figma node ID")
      .requiredOption("--out <path>", "baseline PNG output")
      .option("--scale <number>", "Figma image scale", positiveNumber)
      .option("--canvas-fill <color>", "canvas fill such as #fff")
      .action(fetchGoldCommand),
  );

  program.addCommand(
    subcommand("compare", "Compare baseline and actual PNG files.")
      .requiredOption("--gold <path>", "baseline PNG")
      .requiredOption("--actual <path>", "actual PNG")
      .option("--out-dir <dir>", "comparison artifact directory")
      .addOption(
        new Option("--profile <profile>", "comparison profile")
          .choices(["page", "component/strict", "component/dev"])
          .default("component/strict"),
      )
      .action(compareCommand),
  );
}
