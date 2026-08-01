import { Command, InvalidArgumentError, Option } from "commander";

import {
  EXIT_OK,
  EXIT_USAGE_ERROR,
  EXIT_VISUAL_FAIL,
  JSON_INDENT_SPACES,
  run,
} from "@figloom/verify";
import { positiveNumber, subcommand } from "./shared.ts";

type Profile = "component/strict" | "component/dev" | "page";

interface RunOptions {
  url: string;
  viewport: string;
  viewportSize: { width: number; height: number };
  gold: string;
  outDir: string;
  nodeId: string;
  selector?: string;
  profile?: Profile;
  pageReason?: string;
  runType: "dev" | "final";
  expectWidth?: number;
  expectHeight?: number;
  stabilitySamples?: number;
  timeoutMs?: number;
  hideDevtoolsChrome?: boolean;
  devtoolsMarker?: string;
}

function viewportSize(raw: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/.exec(raw);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (
    !match ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new InvalidArgumentError("must use positive WxH dimensions, for example 1440x1024");
  }
  return { width, height };
}

async function runCommand(options: RunOptions): Promise<void> {
  const result = await run({
    url: options.url,
    viewport: options.viewport,
    viewportSize: options.viewportSize,
    goldPath: options.gold,
    outDir: options.outDir,
    nodeId: options.nodeId,
    selector: options.selector,
    profile: options.profile,
    pageReason: options.pageReason,
    runType: options.runType,
    expectSize:
      options.expectWidth && options.expectHeight
        ? { width: options.expectWidth, height: options.expectHeight }
        : undefined,
    stabilitySamples: options.stabilitySamples,
    timeoutMs: options.timeoutMs,
    hideDevtoolsChrome: options.hideDevtoolsChrome,
    devtoolsMarker: options.devtoolsMarker,
  });
  console.log(JSON.stringify(result, null, JSON_INDENT_SPACES));
  process.exitCode = !result.ok ? EXIT_USAGE_ERROR : result.pass ? EXIT_OK : EXIT_VISUAL_FAIL;
}

export function registerRunCommand(program: Command): void {
  program.addCommand(
    subcommand("run", "Capture URL and compare it with a baseline image.")
      .requiredOption("--url <url>", "target URL")
      .requiredOption("--viewport <name>", "viewport name")
      .requiredOption("--viewport-size <WxH>", "viewport dimensions", viewportSize)
      .requiredOption("--gold <path>", "baseline PNG")
      .requiredOption("--out-dir <dir>", "verification artifact directory")
      .requiredOption("--node-id <id>", "baseline node identity")
      .option("--selector <css>", "region CSS selector")
      .addOption(
        new Option("--profile <profile>", "comparison profile").choices([
          "page",
          "component/strict",
          "component/dev",
        ]),
      )
      .option("--page-reason <reason>", "full-page scope reason")
      .addOption(new Option("--run-type <type>", "run type").choices(["dev", "final"]).default("dev"))
      .addOption(new Option("--expect-width <px>", "expected region width").argParser(positiveNumber))
      .addOption(new Option("--expect-height <px>", "expected region height").argParser(positiveNumber))
      .option("--stability-samples <count>", "stability sample count", positiveNumber)
      .option("--timeout-ms <ms>", "capture timeout", positiveNumber)
      .option("--hide-devtools-chrome", "hide development chrome")
      .addOption(new Option("--devtools-marker <text>", "development chrome marker"))
      .action(async (options: RunOptions, activeCommand: Command) => {
        if ((options.expectWidth == null) !== (options.expectHeight == null)) {
          activeCommand.error("error: --expect-width and --expect-height must be used together");
        }
        if (options.devtoolsMarker != null && options.hideDevtoolsChrome !== true) {
          activeCommand.error("error: --devtools-marker requires --hide-devtools-chrome");
        }
        await runCommand(options);
      }),
  );
}
