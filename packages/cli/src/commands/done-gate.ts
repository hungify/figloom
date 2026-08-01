import * as fs from "node:fs";
import * as path from "node:path";

import { Option, type Command } from "commander";

import { verificationArtifactSchema } from "@figloom/contracts";
import {
  doneGateFromArtifact,
  EXIT_OK,
  EXIT_VISUAL_FAIL,
  JSON_INDENT_SPACES,
} from "@figloom/verify";
import { positiveNumber, subcommand } from "./shared.ts";

interface DoneGateOptions {
  artifact: string;
  maxScoreAgeMs?: number;
  maxBaselineAgeMs?: number;
  maxGoldAgeMs?: number;
}

function readArtifact(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(`Cannot read JSON ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function doneGateCommand(options: DoneGateOptions): Promise<void> {
  const artifact = verificationArtifactSchema.parse(readArtifact(options.artifact));
  const verdict = doneGateFromArtifact(artifact, {
    maxScoreAgeMs: options.maxScoreAgeMs,
    maxBaselineAgeMs: options.maxBaselineAgeMs ?? options.maxGoldAgeMs,
  });
  console.log(
    JSON.stringify({ artifactPath: path.resolve(options.artifact), ...verdict }, null, JSON_INDENT_SPACES),
  );
  process.exitCode = verdict.done ? EXIT_OK : EXIT_VISUAL_FAIL;
}

export function registerDoneGateCommand(program: Command): void {
  program.addCommand(
    subcommand("done-gate", "Evaluate final done gate from verification evidence.")
      .requiredOption("--artifact <path>", "verification artifact JSON")
      .option("--max-score-age-ms <ms>", "maximum score age", positiveNumber)
      .option("--max-baseline-age-ms <ms>", "maximum baseline age", positiveNumber)
      .addOption(
        new Option("--max-gold-age-ms <ms>", "deprecated alias for --max-baseline-age-ms")
          .argParser(positiveNumber)
          .hideHelp(),
      )
      .action(doneGateCommand),
  );
}
